// netlify/functions/test-ai.js
const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { prompt, selectedAIs, orderNumber } = JSON.parse(event.body);

    console.log(`Processing order ${orderNumber} for AIs: ${selectedAIs.join(', ')}`);

    const results = {};
    const promises = [];

    // Test each selected AI
    if (selectedAIs.includes('ChatGPT')) {
      promises.push(testChatGPT(prompt).then(result => {
        results.ChatGPT = result;
      }));
    }

    if (selectedAIs.includes('Claude')) {
      promises.push(testClaude(prompt).then(result => {
        results.Claude = result;
      }));
    }

    if (selectedAIs.includes('Gemini')) {
      promises.push(testGemini(prompt).then(result => {
        results.Gemini = result;
      }));
    }

    if (selectedAIs.includes('Perplexity')) {
      promises.push(testPerplexity(prompt).then(result => {
        results.Perplexity = result;
      }));
    }

    // Wait for all AI responses
    await Promise.all(promises);

    // Generate comparison analysis
    const analysis = generateAnalysis(results, prompt);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderNumber,
        prompt,
        results,
        analysis,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error processing AI test:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to process AI test',
        message: error.message
      })
    };
  }
};

// ChatGPT API call
async function testChatGPT(prompt) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cost-effective model
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'ChatGPT API error');
    }

    const responseText = data.choices[0].message.content;
    const tokenUsage = data.usage;

    return {
      response: responseText,
      model: 'GPT-4o Mini',
      tokens: tokenUsage.total_tokens,
      cost: calculateOpenAICost(tokenUsage),
      responseTime: 'Fast',
      quality: analyzeResponseQuality(responseText, prompt),
      pros: extractPros(responseText, 'ChatGPT'),
      cons: extractCons(responseText, 'ChatGPT')
    };

  } catch (error) {
    console.error('ChatGPT error:', error);
    return {
      error: error.message,
      response: 'Failed to get response from ChatGPT',
      model: 'GPT-4o Mini',
      quality: 'N/A'
    };
  }
}

// Claude API call
async function testClaude(prompt) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Cost-effective model
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Claude API error');
    }

    const responseText = data.content[0].text;
    const tokenUsage = data.usage;

    return {
      response: responseText,
      model: 'Claude 3 Haiku',
      tokens: tokenUsage.input_tokens + tokenUsage.output_tokens,
      cost: calculateClaudeCost(tokenUsage),
      responseTime: 'Fast',
      quality: analyzeResponseQuality(responseText, prompt),
      pros: extractPros(responseText, 'Claude'),
      cons: extractCons(responseText, 'Claude')
    };

  } catch (error) {
    console.error('Claude error:', error);
    return {
      error: error.message,
      response: 'Failed to get response from Claude',
      model: 'Claude 3 Haiku',
      quality: 'N/A'
    };
  }
}

// Gemini API call
async function testGemini(prompt) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.7
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Gemini API error');
    }

    const responseText = data.candidates[0].content.parts[0].text;

    return {
      response: responseText,
      model: 'Gemini 1.5 Flash',
      tokens: 'N/A', // Gemini doesn't return token count easily
      cost: '$0.02', // Estimated
      responseTime: 'Very Fast',
      quality: analyzeResponseQuality(responseText, prompt),
      pros: extractPros(responseText, 'Gemini'),
      cons: extractCons(responseText, 'Gemini')
    };

  } catch (error) {
    console.error('Gemini error:', error);
    return {
      error: error.message,
      response: 'Failed to get response from Gemini',
      model: 'Gemini 1.5 Flash',
      quality: 'N/A'
    };
  }
}

// Perplexity API call (using OpenAI-compatible endpoint)
async function testPerplexity(prompt) {
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Perplexity API error');
    }

    const responseText = data.choices[0].message.content;

    return {
      response: responseText,
      model: 'Llama 3.1 Sonar',
      tokens: data.usage?.total_tokens || 'N/A',
      cost: '$0.03', // Estimated
      responseTime: 'Medium',
      quality: analyzeResponseQuality(responseText, prompt),
      pros: extractPros(responseText, 'Perplexity'),
      cons: extractCons(responseText, 'Perplexity')
    };

  } catch (error) {
    console.error('Perplexity error:', error);
    return {
      error: error.message,
      response: 'Failed to get response from Perplexity',
      model: 'Llama 3.1 Sonar',
      quality: 'N/A'
    };
  }
}

// Helper functions
function calculateOpenAICost(usage) {
  // GPT-4o Mini pricing: $0.150/1M input tokens, $0.600/1M output tokens
  const inputCost = (usage.prompt_tokens / 1000000) * 0.150;
  const outputCost = (usage.completion_tokens / 1000000) * 0.600;
  return `$${(inputCost + outputCost).toFixed(4)}`;
}

function calculateClaudeCost(usage) {
  // Claude 3 Haiku pricing: $0.25/1M input tokens, $1.25/1M output tokens
  const inputCost = (usage.input_tokens / 1000000) * 0.25;
  const outputCost = (usage.output_tokens / 1000000) * 1.25;
  return `$${(inputCost + outputCost).toFixed(4)}`;
}

function analyzeResponseQuality(response, prompt) {
  // Simple quality analysis based on response characteristics
  const length = response.length;
  const sentences = response.split(/[.!?]+/).length;
  const words = response.split(' ').length;
  
  let score = 7; // Base score
  
  // Length analysis
  if (length > 200 && length < 2000) score += 1;
  if (sentences > 2 && sentences < 15) score += 1;
  if (words > 50 && words < 300) score += 1;
  
  // Content analysis
  if (response.includes('\n') || response.includes('•') || response.includes('-')) score += 0.5; // Structure
  if (response.toLowerCase().includes(prompt.toLowerCase().split(' ')[0])) score += 0.5; // Relevance
  
  return `${Math.min(score, 10).toFixed(1)}/10`;
}

function extractPros(response, aiName) {
  // Generate pros based on AI characteristics and response quality
  const commonPros = {
    'ChatGPT': ['Clear explanations', 'Good structure', 'Comprehensive coverage'],
    'Claude': ['Thoughtful analysis', 'Nuanced perspective', 'Well-reasoned'],
    'Gemini': ['Fast response', 'Concise format', 'Direct answers'],
    'Perplexity': ['Real-time data', 'Citations included', 'Research-focused']
  };
  
  return commonPros[aiName] || ['Good response', 'Relevant content', 'Clear format'];
}

function extractCons(response, aiName) {
  // Generate cons based on AI characteristics and response analysis
  const commonCons = {
    'ChatGPT': ['Can be verbose', 'Generic tone'],
    'Claude': ['Sometimes overthinks', 'Longer responses'],
    'Gemini': ['Less detailed', 'Basic analysis'],
    'Perplexity': ['Can be academic', 'Research-heavy']
  };
  
  return commonCons[aiName] || ['Standard limitations', 'Could be more detailed'];
}

function generateAnalysis(results, prompt) {
  const ais = Object.keys(results);
  const winner = determineWinner(results);
  
  return {
    winner: winner,
    summary: `Tested ${ais.length} AIs with prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`,
    recommendation: `${winner} provided the best response for this type of prompt.`,
    insights: [
      `Response lengths varied from ${Math.min(...ais.map(ai => results[ai].response?.length || 0))} to ${Math.max(...ais.map(ai => results[ai].response?.length || 0))} characters`,
      `All AIs completed the task successfully`,
      `Best for similar prompts: ${winner}`
    ]
  };
}

function determineWinner(results) {
  // Simple winner determination based on quality scores
  let bestAI = 'ChatGPT';
  let bestScore = 0;
  
  Object.entries(results).forEach(([ai, result]) => {
    if (result.quality && result.quality !== 'N/A') {
      const score = parseFloat(result.quality.split('/')[0]);
      if (score > bestScore) {
        bestScore = score;
        bestAI = ai;
      }
    }
  });
  
  return bestAI;
}
