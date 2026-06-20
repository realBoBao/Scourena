import 'dotenv/config';

const QUERY = 'Xin chào, tên bạn là gì? Trả lời ngắn gọn.';

console.log('=== LLM Provider Deep Test ===\n');

// 1. Test Gemini trực tiếp
console.log('--- 1. Gemini (direct API) ---');
try {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.log('❌ No GEMINI_API_KEY');
  } else {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: QUERY }] }] }),
    });
    const data = await res.json();
    if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log(`✅ Gemini: "${data.candidates[0].content.parts[0].text.slice(0, 80)}"`);
    } else {
      console.log(`❌ Gemini ${res.status}:`, JSON.stringify(data).slice(0, 200));
    }
  }
} catch (err) {
  console.log(`❌ Gemini error: ${err.message}`);
}

// 2. Test OpenRouter trực tiếp
console.log('\n--- 2. OpenRouter (direct API) ---');
try {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log('❌ No OPENROUTER_API_KEY');
  } else {
    // Thử model free đầu tiên
    const models = ['google/gemini-2.0-flash-001', 'google/gemma-2-9b-it:free', 'mistralai/mistral-7b-instruct:free'];
    for (const model of models) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: QUERY }],
            max_tokens: 100,
          }),
        });
        const data = await res.json();
        if (res.ok && data.choices?.[0]?.message?.content) {
          console.log(`✅ OpenRouter (${model}): "${data.choices[0].message.content.slice(0, 80)}"`);
          break;
        } else {
          console.log(`❌ OpenRouter (${model}) ${res.status}:`, JSON.stringify(data).slice(0, 150));
        }
      } catch (err) {
        console.log(`❌ OpenRouter (${model}): ${err.message}`);
      }
    }
  }
} catch (err) {
  console.log(`❌ OpenRouter error: ${err.message}`);
}

// 3. Test Groq trực tiếp
console.log('\n--- 3. Groq (direct API) ---');
try {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.log('❌ No GROQ_API_KEY');
  } else {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: QUERY }],
        max_tokens: 100,
      }),
    });
    const data = await res.json();
    if (res.ok && data.choices?.[0]?.message?.content) {
      console.log(`✅ Groq: "${data.choices[0].message.content.slice(0, 80)}"`);
    } else {
      console.log(`❌ Groq ${res.status}:`, JSON.stringify(data).slice(0, 200));
    }
  }
} catch (err) {
  console.log(`❌ Groq error: ${err.message}`);
}

console.log('\n=== Done ===');
