// index.js
const express = require('express');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const twilio = require('twilio');
const fs = require('fs');
const util = require('util');

require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

const port = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const client = new textToSpeech.TextToSpeechClient();
const twiml = twilio.twiml;

let conversationHistory = [
  {
    role: 'system',
    content: "Tu es une assistante virtuelle vocale, polie, douce, professionnelle, qui représente Monsieur Haliwa, un expert en intelligence artificielle. Tu t'exprimes en français, avec clarté, et tu proposes de l'aide dès que possible."
  }
];

app.post('/voice', async (req, res) => {
  const twilioResponse = new twiml.VoiceResponse();
  twilioResponse.play({}, `${baseUrl}/public/intro.mp3`);
  twilioResponse.record({
    timeout: 5,
    transcribe: true,
    transcribeCallback: '/transcribe'
  });
  res.type('text/xml');
  res.send(twilioResponse.toString());
});

app.post('/transcribe', async (req, res) => {
  const userText = req.body.TranscriptionText;
  console.log("Utilisateur a dit :", userText);

  if (!userText) return res.end();
  if (userText.toLowerCase().includes("non")) {
    const goodbye = new twiml.VoiceResponse();
    goodbye.say({ language: 'fr-FR', voice: 'Polly.Celine' }, "Très bien. Je vous souhaite une excellente journée. Au revoir.");
    goodbye.hangup();
    res.type('text/xml');
    return res.send(goodbye.toString());
  }

  conversationHistory.push({ role: 'user', content: userText });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini-2024-07-18',
    messages: conversationHistory,
  });

  const assistantReply = completion.choices[0].message.content;
  conversationHistory.push({ role: 'assistant', content: assistantReply });

  console.log("Assistant :", assistantReply);

  const request = {
    input: { text: assistantReply },
    voice: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-E' },
    audioConfig: { audioEncoding: 'MP3' },
  };

  const [response] = await client.synthesizeSpeech(request);
  await util.promisify(fs.writeFile)('./public/response.mp3', response.audioContent, 'binary');

  const responseTwiml = new twiml.VoiceResponse();
  responseTwiml.play({}, `${baseUrl}/public/response.mp3`);
  responseTwiml.redirect('/voice');
  res.type('text/xml');
  res.send(responseTwiml.toString());
});

app.listen(port, () => {
  console.log(`Serveur actif sur le port ${port}`);
});
