require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');
const { OpenAI } = require("openai");
const { exec } = require('child_process');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ELEVENLABS_API_KEY = "sk_c0ebb91c0d38d70e17f6fe39f790a2cd48f3377b9570b50a";
const ELEVENLABS_VOICE_ID = "rbFGGoDXFHtVghjHuS3E";
const publicPath = __dirname + "/public";

app.use('/public', express.static(publicPath));

app.post('/voice', async (req, res) => {
  const twiml = new require('twilio').twiml.VoiceResponse();
  const speech = req.body.SpeechResult || '';

  const defaultIntro = "Bonjour, je suis l’assistante de Monsieur Aliwa, expert en intelligence artificielle. Comment puis-je vous aider aujourd’hui ?";
  let responseText = defaultIntro;

  try {
    if (speech && speech.length > 2) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: speech }],
      });
      responseText = completion.choices[0].message.content || defaultIntro;
    }
  } catch (error) {
    console.error("Erreur OpenAI :", error.message);
    responseText = "Désolé, une erreur est survenue.";
  }

  try {
    const audio = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        text: responseText,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8
        }
      },
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
      }
    );

    fs.writeFileSync(publicPath + "/response.mp3", audio.data);
    twiml.play({}, `${req.protocol}://${req.get("host")}/public/response.mp3`);
  } catch (error) {
    console.error("Erreur ElevenLabs :", error.message);
    twiml.say("Désolé, je ne peux pas parler pour le moment.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => res.send('Assistant vocal IA en ligne.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur actif sur le port ${PORT}`));
