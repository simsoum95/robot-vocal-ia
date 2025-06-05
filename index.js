// index.js
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const axios = require("axios");
const { twiml } = require("twilio");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/public", express.static("public"));

app.post("/voice", async (req, res) => {
  const voiceResponse = new twiml.VoiceResponse();
  const speech = req.body.SpeechResult || "";

  try {
    let message = "Bonjour, je suis l'assistante de Monsieur Aliwa, expert en intelligence artificielle. Comment puis-je vous aider ?";

    if (speech.toLowerCase().includes("non")) {
      message = "Très bien, je raccroche. Passez une bonne journée.";
      voiceResponse.say({ voice: 'Polly.Celine', language: 'fr-FR' }, message);
      voiceResponse.hangup();
    } else if (speech.trim().length > 2) {
      // Appel � OpenAI pour r�pondre intelligemment
      const gptReply = await generateResponse(speech);
      message = `Un instant... ${gptReply}`;

      // Appel � ElevenLabs
      const audioBuffer = await textToSpeech(message);
      fs.writeFileSync("./public/response.mp3", audioBuffer);

      voiceResponse.play({}, `${process.env.BASE_URL}/public/response.mp3`);
    } else {
      voiceResponse.say({ voice: 'Polly.Celine', language: 'fr-FR' }, message);
      voiceResponse.gather({ input: 'speech', timeout: 3 });
    }
  } catch (e) {
    console.error("Erreur: ", e);
    voiceResponse.say("Désolé, une erreur est survenue.");
  }

  res.type("text/xml");
  res.send(voiceResponse.toString());
});

app.listen(port, () => {
  console.log("Serveur actif sur le port " + port);
});

async function generateResponse(prompt) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini-2024-07-18",
        messages: [
          {
            role: "system",
            content:
              "Tu es une assistante téléphonique pour Monsieur Aliwa, expert en intelligence artificielle. Tu es polie, douce, efficace, et toujours utile."
          },
          { role: "user", content: prompt }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Erreur GPT:", error.response?.data || error.message);
    return "Je suis désolée, une erreur est survenue.";
  }
}

async function textToSpeech(text) {
  try {
    const response = await axios({
      method: "POST",
      url: `https://api.elevenlabs.io/v1/text-to-speech/rbFGGoDXFHtVghjHuS3E`,
      headers: {
        accept: "audio/mpeg",
        "xi-api-key": process.env.ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      data: {
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.4, similarity_boost: 1 }
      },
      responseType: "arraybuffer"
    });
    return response.data;
  } catch (error) {
    console.error("Erreur ElevenLabs:", error.response?.data || error.message);
    throw new Error("Erreur lors de la génération audio");
  }
}
