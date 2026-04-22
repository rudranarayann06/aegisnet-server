const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

function getGeminiClient() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

function getModel(streaming = false) {
  const client = getGeminiClient();
  return client.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

module.exports = { getModel, getGeminiClient };
