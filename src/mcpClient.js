const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
const config = require('../config.json');

async function callMCPTool(serverUrl, toolName, toolArgs) {
  let client;
  try {
    const transport = new SSEClientTransport(new URL(serverUrl));
    client = new Client({ name: 'bugfinder', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    await client.close();
    return result.content;
  } catch (e) {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
    throw new Error(`MCP call failed: server=${serverUrl}, tool=${toolName}: ${e.message}`);
  }
}

async function fetchJiraTicket(ticketId) {
  const serverUrl = config.mcp.jira.url;
  let client;
  try {
    const transport = new SSEClientTransport(new URL(serverUrl));
    client = new Client({ name: 'bugfinder', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // List available tools to find the right one
    const toolList = await client.listTools();
    const availableTools = toolList.tools.map(t => t.name);
    console.log('Jira MCP available tools:', availableTools);

    // Try tool names in order
    const toolCandidates = ['get_issue', 'jira_get_issue', 'getIssue'];
    const argCandidates = [
      { issue_key: ticketId },
      { issueKey: ticketId }
    ];

    let result = null;
    for (const toolName of toolCandidates) {
      if (!availableTools.includes(toolName)) continue;
      for (const args of argCandidates) {
        try {
          result = await client.callTool({ name: toolName, arguments: args });
          if (result && result.content) break;
        } catch (_) {
          continue;
        }
      }
      if (result && result.content) break;
    }

    await client.close();

    if (!result || !result.content) {
      throw new Error(`No working Jira tool found. Available: ${availableTools.join(', ')}`);
    }

    // Parse the response content
    let rawData = '';
    if (Array.isArray(result.content)) {
      rawData = result.content.map(c => c.text || JSON.stringify(c)).join('\n');
    } else if (typeof result.content === 'string') {
      rawData = result.content;
    } else {
      rawData = JSON.stringify(result.content);
    }

    let parsed = {};
    try {
      parsed = JSON.parse(rawData);
    } catch (_) {
      parsed = { description: rawData };
    }

    // Extract fields - NEVER extract acceptance_criteria or AC field
    const title = parsed.summary || parsed.title || parsed.fields?.summary || '';
    const description = parsed.description || parsed.fields?.description || '';
    const comments = [];
    if (parsed.comments && Array.isArray(parsed.comments)) {
      for (const c of parsed.comments) {
        comments.push(typeof c === 'string' ? c : c.body || JSON.stringify(c));
      }
    } else if (parsed.fields?.comment?.comments) {
      for (const c of parsed.fields.comment.comments) {
        comments.push(c.body || JSON.stringify(c));
      }
    }

    const imageUrls = [];
    if (parsed.attachments && Array.isArray(parsed.attachments)) {
      for (const a of parsed.attachments) {
        if (a.content || a.url) imageUrls.push(a.content || a.url);
      }
    } else if (parsed.fields?.attachment) {
      for (const a of parsed.fields.attachment) {
        if (a.content || a.url) imageUrls.push(a.content || a.url);
      }
    }

    const linkedTicketKeys = [];
    if (parsed.linkedIssues && Array.isArray(parsed.linkedIssues)) {
      for (const li of parsed.linkedIssues) {
        const key = li.key || li.issueKey || (li.inwardIssue && li.inwardIssue.key) || (li.outwardIssue && li.outwardIssue.key);
        if (key) linkedTicketKeys.push(key);
      }
    } else if (parsed.fields?.issuelinks) {
      for (const li of parsed.fields.issuelinks) {
        const key = (li.inwardIssue && li.inwardIssue.key) || (li.outwardIssue && li.outwardIssue.key);
        if (key) linkedTicketKeys.push(key);
      }
    }

    // Fetch linked tickets (max 5)
    const linkedTickets = [];
    for (const key of linkedTicketKeys.slice(0, 5)) {
      try {
        const linked = await fetchJiraTicket(key);
        linkedTickets.push(linked);
      } catch (e) {
        console.log(`Could not fetch linked ticket ${key}: ${e.message}`);
      }
    }

    return {
      ticketId,
      title,
      description,
      comments,
      imageUrls,
      linkedTickets
    };
  } catch (e) {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
    throw new Error(`Failed to fetch Jira ticket ${ticketId}: ${e.message}`);
  }
}

async function fetchTestITSuite(suiteIds) {
  if (!suiteIds || suiteIds.length === 0) return [];

  const serverUrl = config.mcp.testit.url;
  let client;
  try {
    const transport = new SSEClientTransport(new URL(serverUrl));
    client = new Client({ name: 'bugfinder', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // List available tools
    const toolList = await client.listTools();
    const availableTools = toolList.tools.map(t => t.name);
    console.log('TestIT MCP available tools:', availableTools);

    const allTestCases = [];

    for (const suiteId of suiteIds) {
      try {
        // Try common tool names for fetching test cases by suite
        const toolCandidates = ['get_test_cases', 'getTestCases', 'get_suite_tests', 'getSuiteTests'];
        let result = null;

        for (const toolName of toolCandidates) {
          if (!availableTools.includes(toolName)) continue;
          try {
            result = await client.callTool({
              name: toolName,
              arguments: { suite_id: suiteId, suiteId: suiteId }
            });
            if (result && result.content) break;
          } catch (_) {
            continue;
          }
        }

        if (result && result.content) {
          let rawData = '';
          if (Array.isArray(result.content)) {
            rawData = result.content.map(c => c.text || JSON.stringify(c)).join('\n');
          } else if (typeof result.content === 'string') {
            rawData = result.content;
          } else {
            rawData = JSON.stringify(result.content);
          }

          let testCases = [];
          try {
            testCases = JSON.parse(rawData);
            if (!Array.isArray(testCases)) testCases = [testCases];
          } catch (_) {
            testCases = [{ name: rawData, steps: '', expectedResult: '', status: '' }];
          }

          for (const tc of testCases) {
            allTestCases.push({
              name: tc.name || tc.title || '',
              steps: tc.steps || tc.description || '',
              expectedResult: tc.expectedResult || tc.expected || '',
              status: tc.status || ''
            });
          }
        }
      } catch (e) {
        console.log(`Warning: Could not fetch TestIT suite ${suiteId}: ${e.message}`);
      }
    }

    await client.close();
    return allTestCases;
  } catch (e) {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
    console.log(`Warning: TestIT fetch failed: ${e.message}`);
    return [];
  }
}

module.exports = { fetchJiraTicket, fetchTestITSuite };
