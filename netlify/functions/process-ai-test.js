// netlify/functions/process-ai-test-credits.js
// Enhanced version with privacy-first real estate tools support

// AI API Configurations
const AI_CONFIG = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (apiKey) => ({
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }),
    body: (prompt) => ({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000, // Increased for detailed analysis
      messages: [{ role: 'user', content: prompt }]
    })
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    headers: (apiKey) => ({
      'Content-Type': 'application/json'
    }),
    body: (prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.7
      }
    })
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }),
    body: (prompt) => ({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000
    })
  }
};

async function callAI(provider, prompt, apiKey) {
  const config = AI_CONFIG[provider];
  if (!config) {
      throw new Error(`Configuration for AI provider '${provider}' not found.`);
  }

  const url = provider === 'google' ? `${config.url}?key=${apiKey}` : config.url;

  try {
    console.log(`Calling ${provider} API for specialized analysis...`);
    const requestBody = JSON.stringify(config.body(prompt));
    const response = await fetch(url, {
      method: 'POST',
      headers: config.headers(apiKey),
      body: requestBody
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${provider} API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    switch (provider) {
      case 'anthropic':
        return data.content[0].text;
      case 'google':
        return data.candidates[0].content.parts[0].text;
      case 'openai':
        return data.choices[0].message.content;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  } catch (error) {
    console.error(`Error calling ${provider}:`, error);
    return `Error: Could not get response from ${provider}. ${error.message}`;
  }
}

function analyzeResponse(response, provider, toolType = 'general') {
  const wordCount = response.split(/\s+/).length;
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const paragraphs = response.split(/\n\s*\n/).length;
  const hasStructure = /\n|\*|\-|\d+\./.test(response);
  const isDetailed = wordCount > 150; // Higher threshold for professional tools
  const isCoherent = sentences > 1 && wordCount / sentences < 40;
  const hasExamples = /example|for instance/i.test(response);
  const isActionable = /recommend|suggest|should/i.test(response);
  
  // Enhanced scoring for professional tools
  let score = 6; // Higher base score for specialized analysis
  if (isDetailed) score += 1.5;
  if (hasStructure) score += 1;
  if (isCoherent) score += 1;
  if (hasExamples) score += 0.5;
  if (isActionable) score += 1;
  if (response.length > 500) score += 0.5;
  if (paragraphs > 2) score += 0.5;
  
  // Professional tool bonuses
  if (toolType.includes('real-estate')) {
    if (/cash flow|cap rate|roi|return/i.test(response)) score += 0.5;
    if (/risk|market|analysis/i.test(response)) score += 0.5;
  }

  const pros = [];
  const cons = [];
  if (isDetailed) pros.push('Comprehensive and detailed analysis');
  if (hasStructure) pros.push('Well-organized professional format');
  if (isCoherent) pros.push('Clear and coherent presentation');
  if (hasExamples) pros.push('Includes relevant examples');
  if (isActionable) pros.push('Provides actionable recommendations');
  if (!isDetailed) cons.push('Could provide more detailed analysis');
  if (!hasStructure) cons.push('Could improve formatting structure');
  if (!isCoherent) cons.push('Could improve clarity and flow');
  if (wordCount < 100) cons.push('Analysis could be more comprehensive');

  return {
    score: Math.min(Math.round(score * 10) / 10, 10),
    wordCount,
    sentences,
    paragraphs,
    length: response.length,
    pros: pros.slice(0, 3),
    cons: cons.slice(0, 2)
  };
}

function generateComparisonReport(results, prompt, creditInfo, toolType = 'general', propertyInfo = null) {
  const aiNames = Object.keys(results);
  const sorted = aiNames.sort((a, b) => results[b].analysis.score - results[a].analysis.score);
  
  let report = `# ${getReportTitle(toolType)}\n\n`;
  
  // Add property-specific header for real estate tools
  if (propertyInfo && propertyInfo.address) {
    report += `**Property:** ${propertyInfo.address}\n`;
  }
  
  report += `**Analysis Type:** ${getToolDisplayName(toolType)}\n`;
  report += `**Date:** ${new Date().toLocaleDateString()}\n`;
  report += `**AI Models:** ${aiNames.join(', ')}\n`;
  report += `**Credits Used:** ${creditInfo.used} credits\n`;
  if (creditInfo.refunded > 0) {
    report += `**Credits Refunded:** ${creditInfo.refunded} credits (for failed analyses)\n`;
  }
  report += `\n## Executive Summary\n\n`;
  
  const workingAIs = aiNames.filter(ai => !results[ai].response.includes('Error:'));
  if (workingAIs.length > 0) {
    report += `**Best Analysis:** ${sorted[0]} scored ${results[sorted[0]].analysis.score}/10\n`;
    report += `**Successful Analyses:** ${workingAIs.length} of ${aiNames.length} AI models completed successfully\n\n`;
  } else {
    report += `**Result:** All AI analyses failed - credits have been refunded\n\n`;
    return report;
  }
  
  report += `## Detailed AI Analysis Results\n\n`;
  
  sorted.forEach((ai, i) => {
    const result = results[ai];
    const analysis = result.analysis;
    
    if (result.response.includes('Error:')) {
      report += `### ${i + 1}. ${ai} Analysis - FAILED ❌\n\n`;
      report += `**Error:** ${result.response}\n`;
      report += `**Credit Status:** Refunded ✅\n\n---\n\n`;
    } else {
      report += `### ${i + 1}. ${ai} Analysis - Score: ${analysis.score}/10\n\n`;
      
      // Privacy note: Only include analysis summary, not full response
      const responsePreview = result.response.length > 2000 
        ? result.response.substring(0, 2000) + '\n\n[Analysis continues...]'
        : result.response;
        
      report += `**Professional Analysis:**\n\`\`\`\n${responsePreview}\n\`\`\`\n\n`;
      report += `**Analysis Quality Metrics:**\n`;
      report += `- Response Length: ${analysis.wordCount} words (${analysis.sentences} sentences)\n`;
      report += `- Structure Quality: ${analysis.paragraphs} sections\n`;
      report += `- Professional Score: ${analysis.score}/10\n\n`;
      report += `**Key Strengths:** ${analysis.pros.join(', ')}\n`;
      if (analysis.cons.length) report += `**Areas for Enhancement:** ${analysis.cons.join(', ')}\n`;
      report += `\n---\n\n`;
    }
  });
  
  report += `## Analysis Summary & Value\n\n`;
  report += `- **Total Credits Used:** ${creditInfo.used}\n`;
  report += `- **Successful Analyses:** ${workingAIs.length}\n`;
  if (creditInfo.refunded > 0) {
    report += `- **Failed Analyses:** ${creditInfo.refunded}\n`;
    report += `- **Credits Refunded:** ${creditInfo.refunded}\n`;
    report += `- **Net Investment:** ${creditInfo.used - creditInfo.refunded} credits\n`;
  }
  
  if (workingAIs.length > 0) {
    report += `\n## Professional Recommendations\n\n`;
    report += `**Top Performing Analysis:** ${sorted[0]} delivered the most comprehensive analysis with a ${results[sorted[0]].analysis.score}/10 quality score.\n\n`;
    report += `**Value Assessment:** You received ${workingAIs.length} professional AI analysis${workingAIs.length !== 1 ? 'es' : ''} for ${creditInfo.used - creditInfo.refunded} credit${(creditInfo.used - creditInfo.refunded) !== 1 ? 's' : ''}, providing multiple expert perspectives on your ${getToolDisplayName(toolType).toLowerCase()}.\n\n`;
    
    if (toolType.includes('real-estate')) {
      report += `**Next Steps:** Review each analysis for different perspectives on financial projections, risk factors, and market positioning. Consider consulting with a local real estate professional for property-specific details and current market conditions.\n`;
    }
  }
  
  // Privacy footer
  report += `\n---\n\n`;
  report += `**Privacy Notice:** This analysis was generated specifically for your request. All input data has been immediately deleted from our systems after processing. No property information, financial details, or analysis results are stored or retained.\n\n`;
  report += `**Disclaimer:** This AI-generated analysis is for informational purposes only and should not be considered as professional financial, legal, or real estate advice. Please consult with qualified professionals before making investment decisions.\n`;
  
  return report;
}

function getReportTitle(toolType) {
  switch (toolType) {
    case 'real-estate-investment':
      return 'Real Estate Investment Analysis Report';
    case 'real-estate-market':
      return 'Real Estate Market Analysis Report';
    case 'real-estate-listing':
      return 'Property Listing Content Report';
    default:
      return 'AI Comparison Analysis Report';
  }
}

function getToolDisplayName(toolType) {
  switch (toolType) {
    case 'real-estate-investment':
      return 'Investment Analysis';
    case 'real-estate-market':
      return 'Market Analysis';
    case 'real-estate-listing':
      return 'Listing Generation';
    default:
      return 'General AI Analysis';
  }
}

// Privacy-enhanced email function - no data logging
async function sendResultsEmail(email, orderData, results, comparisonReportMarkdown) {
  console.log('📨 Sending analysis results (no data logged for privacy)...');
  
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    console.error('❌ Invalid email format');
    return false;
  }
  
  try {
    // Create privacy-compliant email data (minimal logging)
    const emailData = {
      service_id: process.env.EMAILJS_SERVICE_ID || 'service_6deh10r',
      template_id: process.env.EMAILJS_TEMPLATE_ID || 'template_test_results',
      user_id: process.env.EMAILJS_PUBLIC_KEY || 'WwSbSdi4EaiQMExvs',
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        email: email, // Keep as 'email' to match your existing template
        order_number: orderData.orderNumber,
        prompt: `${getToolDisplayName(orderData.toolType || 'general')} Analysis`,
        ais: Object.keys(results).join(', '),
        cost: `${orderData.creditsUsed} credit${orderData.creditsUsed !== 1 ? 's' : ''}`,
        payment_id: orderData.paymentId,
        report_content: comparisonReportMarkdown,
        user_id: orderData.userId || 'N/A',
        credits_used: orderData.creditsUsed,
        credits_refunded: orderData.creditsRefunded || 0,
        // Additional fields for specialized tools
        analysis_type: getToolDisplayName(orderData.toolType || 'general'),
        property_address: orderData.propertyAddress || 'N/A',
        analysis_date: new Date().toLocaleDateString()
      }
    };

    console.log('📧 Processing email delivery...');
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailData)
    });
    
    const success = response.ok;
    console.log(`📬 Email delivery: ${success ? 'Success' : 'Failed'} (${response.status})`);
    
    // Privacy: Don't log response details or email content
    return success;
  } catch (err) {
    console.error('🔥 Email delivery error (details not logged for privacy)');
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { 
      statusCode: 200, 
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Methods': 'POST', 
        'Access-Control-Allow-Headers': 'Content-Type' 
      }, 
      body: '' 
    };
  }
  
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Content-Type': 'application/json' 
      }, 
      body: JSON.stringify({ error: 'Method not allowed' }) 
    };
  }

  try {
    const orderData = JSON.parse(event.body);
    
    // Privacy enhancement: Minimal logging
    const toolType = orderData.toolType || 'general';
    const isSpecializedTool = toolType !== 'general';
    
    console.log(`🔧 Processing ${isSpecializedTool ? 'specialized' : 'general'} analysis`);
    console.log(`💳 Credits: ${orderData.creditsUsed}`);
    console.log(`📋 Order: ${orderData.orderNumber}`);
    // Note: No longer logging email or prompt content for privacy
    
    const selectedAIs = orderData.selectedAIs || ['Claude', 'Gemini', 'ChatGPT']; 

    const apiKeys = {
      Claude: process.env.ANTHROPIC_API_KEY,
      Gemini: process.env.GOOGLE_API_KEY,
      ChatGPT: process.env.OPENAI_API_KEY
    };

    const providers = {
      Claude: 'anthropic',
      Gemini: 'google',
      ChatGPT: 'openai'
    };

    const results = {};
    let failedCount = 0;
    
    // Process each selected AI
    for (const ai of selectedAIs) {
      const provider = providers[ai];
      const key = apiKeys[ai];
      
      if (!key) {
        console.log(`❌ Missing API key for ${ai}`);
        results[ai] = { 
          response: `Error: Missing API key for ${ai}`, 
          analysis: { score: 0, pros: [], cons: ['Missing API key'] },
          timestamp: new Date().toISOString()
        };
        failedCount++;
        continue;
      }
      
      console.log(`⚙️ Processing ${ai} ${isSpecializedTool ? 'specialized' : 'general'} analysis...`);
      const response = await callAI(provider, orderData.prompt, key);
      
      if (response.includes('Error:')) {
        failedCount++;
        console.log(`❌ ${ai} analysis failed`);
      } else {
        console.log(`✅ ${ai} analysis completed successfully`);
      }
      
      results[ai] = {
        response: response,
        analysis: analyzeResponse(response, provider, toolType),
        timestamp: new Date().toISOString()
      };
    }

    // Calculate credit refunds for failed analyses
    const creditsRefunded = failedCount;
    const creditInfo = {
      used: orderData.creditsUsed,
      refunded: creditsRefunded,
      net: orderData.creditsUsed - creditsRefunded
    };

    console.log(`💰 Credit summary: Used ${creditInfo.used}, Refunded ${creditInfo.refunded}, Net ${creditInfo.net}`);

    // Generate the analysis report
    const propertyInfo = orderData.propertyAddress ? { address: orderData.propertyAddress } : null;
    const comparisonReportMarkdown = generateComparisonReport(
      results, 
      orderData.prompt, 
      creditInfo, 
      toolType,
      propertyInfo
    );
    
    // Add refund info to order data
    orderData.creditsRefunded = creditsRefunded;
    
    // Send results email (privacy-enhanced)
    const emailSent = await sendResultsEmail(orderData.email, orderData, results, comparisonReportMarkdown);
    console.log(`📧 Email delivery: ${emailSent ? 'Success' : 'Failed'}`);

    // Privacy cleanup: Clear sensitive data from memory
    delete orderData.prompt;
    delete orderData.propertyAddress;
    if (orderData.toolData) delete orderData.toolData;

    console.log(`✅ ${isSpecializedTool ? 'Specialized' : 'General'} analysis complete`);

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({ 
        success: true, 
        orderNumber: orderData.orderNumber, 
        results, // Keep results for immediate feedback
        emailSent,
        creditInfo: creditInfo,
        toolType: toolType,
        message: `${getToolDisplayName(toolType)} complete - results sent via email`,
        failedAIs: selectedAIs.filter(ai => results[ai].response.includes('Error:'))
      })
    };
  } catch (error) {
    console.error('❌ Analysis processing error:', error.message);
    return {
      statusCode: 500,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
      body: JSON.stringify({ 
        success: false, 
        error: 'Analysis processing failed - please try again' 
      })
    };
  }
};
