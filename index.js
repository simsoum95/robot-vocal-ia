const express = require("express");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const twilio = require("twilio");
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuration email
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use('/audio', express.static('audio')); // Serve audio files

// Ensure audio directory exists
if (!fs.existsSync('audio')) {
  fs.mkdirSync('audio');
}

// Function to generate speech with ElevenLabs
async function generateSpeech(text, filename) {
  try {
    const response = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      data: {
        text: text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true
        }
      },
      responseType: 'arraybuffer'
    });

    const audioPath = path.join('audio', `${filename}.mp3`);
    fs.writeFileSync(audioPath, response.data);
    return audioPath;
  } catch (error) {
    console.error('Error generating speech:', error);
    return null;
  }
}

// Function to create TwiML with ElevenLabs audio
async function createTwiMLWithSpeech(text, gatherOptions = null) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  
  // Generate unique filename
  const filename = `speech_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const audioPath = await generateSpeech(text, filename);
  
  if (audioPath && gatherOptions) {
    const gather = twiml.gather(gatherOptions);
    gather.play(`${process.env.BASE_URL || 'https://your-app-url.com'}/audio/${filename}.mp3`);
  } else if (audioPath) {
    twiml.play(`${process.env.BASE_URL || 'https://your-app-url.com'}/audio/${filename}.mp3`);
  } else {
    // Fallback to Twilio's TTS if ElevenLabs fails
    if (gatherOptions) {
      const gather = twiml.gather(gatherOptions);
      gather.say({ voice: "Polly.Celine", language: "fr-FR" }, text);
    } else {
      twiml.say({ voice: "Polly.Celine", language: "fr-FR" }, text);
    }
  }
  
  return twiml;
}

// Fonction pour vérifier les horaires d'ouverture
function isBusinessHours() {
  const now = new Date();
  const day = now.getDay(); // 0 = Dimanche, 1 = Lundi, etc.
  const hour = now.getHours();
  
  // Dimanche à Jeudi (0,1-4): 9h-18h
  if ((day === 0) || (day >= 1 && day <= 4)) {
    return hour >= 9 && hour < 18;
  }
  // Vendredi et Samedi fermé
  return false;
}

// Fonction pour envoyer un email
async function sendEmail(subject, message, senderInfo = '') {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'simonhaliwa@gmail.com',
      subject: `Dream Team - ${subject}`,
      text: `${message}\n\n${senderInfo}`
    };
    
    await transporter.sendMail(mailOptions);
    console.log('Email envoyé avec succès');
    return true;
  } catch (error) {
    console.error('Erreur envoi email:', error);
    return false;
  }
}

// Fonction pour détecter si l'appelant veut terminer l'appel
function wantsToEndCall(speech) {
  const endCallPhrases = [
    "terminer l'appel",
    "raccrocher",
    "c'est tout",
    "ça sera tout",
    "vous pouvez raccrocher",
    "fin de l'appel",
    "au revoir",
    "bonne journée",
    "merci c'est tout",
    "j'ai terminé",
    "plus rien",
    "rien d'autre"
  ];
  
  const lowerSpeech = speech.toLowerCase();
  return endCallPhrases.some(phrase => lowerSpeech.includes(phrase));
}

let conversationContext = {};

app.post("/voice", async (req, res) => {
  // Vérifier les horaires d'ouverture
  if (!isBusinessHours()) {
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process-after-hours",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Bonjour, vous êtes bien chez Dream Team. Vous appelez en dehors de nos horaires d'ouverture. Nous sommes ouverts du dimanche au jeudi de 9 heures à 18 heures. Vous pouvez laisser un message vocal, il sera transmis à Monsieur Haliwa par email.";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  } else {
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Bonjour, vous êtes bien chez Dream Team, comment puis-je vous aider ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.post("/process-after-hours", async (req, res) => {
  const userSpeech = req.body.SpeechResult;

  if (!userSpeech) {
    const text = "Désolée, je n'ai pas compris votre message. Au revoir.";
    const twiml = await createTwiMLWithSpeech(text);
    twiml.hangup();
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Envoyer le message vocal par email
  const emailSent = await sendEmail(
    "Message vocal hors horaires",
    `Message vocal reçu en dehors des horaires d'ouverture:\n\n"${userSpeech}"`,
    `Reçu le: ${new Date().toLocaleString('fr-FR')}`
  );

  let text;
  if (emailSent) {
    text = "Merci, votre message a été transmis à Monsieur Haliwa. Il vous recontactera dès que possible. Bonne journée.";
  } else {
    text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Au revoir.";
  }

  const twiml = await createTwiMLWithSpeech(text);
  twiml.hangup();
  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process", async (req, res) => {
  const userSpeech = req.body.SpeechResult;
  const callSid = req.body.CallSid;

  if (!userSpeech) {
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Je suis désolée, je n'ai pas bien compris. Pouvez-vous reformuler votre demande ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // Vérifier si l'appelant veut terminer l'appel
  if (wantsToEndCall(userSpeech)) {
    const text = "Très bien, bonne journée et merci d'avoir appelé Dream Team.";
    const twiml = await createTwiMLWithSpeech(text);
    twiml.hangup();
    delete conversationContext[callSid];
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    // Analyser l'intention avec GPT
    const intentAnalysis = await openai.chat.completions.create({
      model: "gpt-4o-mini-2024-07-18",
      messages: [
        { 
          role: "system", 
          content: `Tu es un analyseur d'intentions pour un standard téléphonique. Analyse le message de l'appelant et réponds UNIQUEMENT par l'un de ces mots:
          - "HORAIRES" si la personne demande les horaires d'ouverture
          - "RENDEZ_VOUS" si la personne veut prendre rendez-vous avec Monsieur Haliwa
          - "PROBLEME" si la personne dit avoir un problème, expose un problème ou pose une question
          - "TRANSFERT" si la personne demande explicitement à être transférée ou à parler à quelqu'un
          - "AUTRE" pour tout autre cas
          
          IMPORTANT: Le mot "non" seul ne doit pas être interprété comme une fin d'appel. Analyse le contexte complet.
          
          Ne réponds que par un seul mot.`
        },
        { role: "user", content: userSpeech }
      ]
    });

    const intention = intentAnalysis.choices[0].message.content.trim();
    let twiml;

    if (intention === "HORAIRES") {
      // Gestion des demandes d'horaires
      if (!conversationContext[callSid] || conversationContext[callSid].lastAction !== "horaires") {
        conversationContext[callSid] = { step: "horaires_response", lastAction: "horaires" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        const text = "Nous sommes ouverts du dimanche au jeudi, de 9 heures à 18 heures. Souhaitez-vous recevoir ces informations par email également ?";
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        
      } else if (conversationContext[callSid].step === "horaires_response") {
        if (userSpeech.toLowerCase().includes("oui") || userSpeech.toLowerCase().includes("email")) {
          // Demander l'email pour envoyer les horaires
          conversationContext[callSid].step = "get_email_horaires";
          
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Parfait. Pouvez-vous me donner votre adresse email s'il vous plaît ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          
        } else {
          // Pas d'email souhaité - continuer la conversation
          conversationContext[callSid] = { lastAction: "completed" };
          
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Très bien. Y a-t-il autre chose pour laquelle je peux vous aider ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
        }
      } else if (conversationContext[callSid].step === "get_email_horaires") {
        // Envoyer les horaires par email
        const emailSent = await sendEmail(
          "Horaires d'ouverture",
          `Voici nos horaires d'ouverture :\n\nDu dimanche au jeudi : 9h00 - 18h00\nVendredi et samedi : Fermé\n\nPour toute question, n'hésitez pas à nous contacter.`,
          `Email de contact: ${userSpeech}\nEnvoyé le: ${new Date().toLocaleString('fr-FR')}`
        );

        conversationContext[callSid] = { lastAction: "completed" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Parfait, les horaires d'ouverture vous ont été envoyés par email. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue lors de l'envoi de l'email. Nos horaires sont du dimanche au jeudi de 9 heures à 18 heures. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
      }

    } else if (intention === "TRANSFERT") {
      // Transfert direct demandé
      const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
      twiml = await createTwiMLWithSpeech(text);
      twiml.dial("+972584469947");
      delete conversationContext[callSid];

    } else if (intention === "RENDEZ_VOUS") {
      // Gestion des rendez-vous
      if (!conversationContext[callSid] || conversationContext[callSid].lastAction !== "rendez_vous") {
        conversationContext[callSid] = { step: "rdv_choice", originalMessage: userSpeech, lastAction: "rendez_vous" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        const text = "Très bien. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre demande pour lui envoyer par email ?";
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        
      } else if (conversationContext[callSid].step === "rdv_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("maintenant")) {
          // Transférer l'appel
          const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
          twiml = await createTwiMLWithSpeech(text);
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else if (userSpeech.toLowerCase().includes("email") || userSpeech.toLowerCase().includes("noter") || userSpeech.toLowerCase().includes("message")) {
          // Demander le message pour le rendez-vous
          conversationContext[callSid].step = "get_rdv_message";
          
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "D'accord. Quel message souhaitez-vous transmettre exactement pour votre demande de rendez-vous ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          
        } else {
          // Redemander le choix
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Je n'ai pas bien compris. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre demande pour lui envoyer par email ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
        }
      } else if (conversationContext[callSid].step === "get_rdv_message") {
        // Envoyer la demande de rendez-vous par email
        const emailSent = await sendEmail(
          "Demande de rendez-vous",
          `Nouvelle demande de rendez-vous :\n\n"${userSpeech}"\n\nDemande initiale : "${conversationContext[callSid].originalMessage}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        conversationContext[callSid] = { lastAction: "completed" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Parfait, votre demande de rendez-vous a été transmise à Monsieur Haliwa. Il vous recontactera dans les plus brefs délais. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard ou contacter directement Monsieur Haliwa au +972584469947. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
      }

    } else if (intention === "PROBLEME") {
      // Gestion des problèmes/questions
      if (!conversationContext[callSid] || conversationContext[callSid].lastAction !== "probleme") {
        conversationContext[callSid] = { step: "problem_choice", originalMessage: userSpeech, lastAction: "probleme" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        const text = "D'accord, je peux transmettre cela à la direction. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre message pour lui envoyer par email ?";
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
        
      } else if (conversationContext[callSid].step === "problem_choice") {
        if (userSpeech.toLowerCase().includes("transf") || userSpeech.toLowerCase().includes("parler") || userSpeech.toLowerCase().includes("maintenant")) {
          // Transférer l'appel
          const text = "Je vous transfère à Monsieur Haliwa. Veuillez patienter.";
          twiml = await createTwiMLWithSpeech(text);
          twiml.dial("+972584469947");
          delete conversationContext[callSid];
        } else if (userSpeech.toLowerCase().includes("email") || userSpeech.toLowerCase().includes("noter") || userSpeech.toLowerCase().includes("message")) {
          // Demander le message détaillé
          conversationContext[callSid].step = "get_problem_message";
          
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Parfait. Quel message souhaitez-vous transmettre exactement ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
          
        } else {
          // Redemander le choix
          const gatherOptions = {
            input: "speech",
            speechTimeout: "auto",
            action: "/process",
            method: "POST",
            language: "fr-FR"
          };

          const text = "Je n'ai pas bien compris. Préférez-vous que je vous transfère à Monsieur Haliwa, ou que je note votre message pour lui envoyer par email ?";
          twiml = await createTwiMLWithSpeech(text, gatherOptions);
        }
      } else if (conversationContext[callSid].step === "get_problem_message") {
        // Envoyer le problème par email
        const emailSent = await sendEmail(
          "Question/Problème client",
          `Nouveau message d'un client :\n\n"${userSpeech}"\n\nMessage initial : "${conversationContext[callSid].originalMessage}"`,
          `Reçu le: ${new Date().toLocaleString('fr-FR')}`
        );

        conversationContext[callSid] = { lastAction: "completed" };
        
        const gatherOptions = {
          input: "speech",
          speechTimeout: "auto",
          action: "/process",
          method: "POST",
          language: "fr-FR"
        };

        let text;
        if (emailSent) {
          text = "Merci, votre message a été transmis à la direction. Vous recevrez une réponse dans les plus brefs délais. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        } else {
          text = "Désolée, une erreur est survenue. Veuillez rappeler plus tard. Y a-t-il autre chose pour laquelle je peux vous aider ?";
        }
        twiml = await createTwiMLWithSpeech(text, gatherOptions);
      }

    } else {
      // Cas général - réponse polie et redirection
      const gatherOptions = {
        input: "speech",
        speechTimeout: "auto",
        action: "/process",
        method: "POST",
        language: "fr-FR"
      };

      const text = "Je suis désolée, je n'ai pas bien compris votre demande. Souhaitez-vous prendre un rendez-vous, connaître nos horaires, ou avez-vous un problème à signaler ?";
      twiml = await createTwiMLWithSpeech(text, gatherOptions);
    }

    res.type("text/xml");
    res.send(twiml.toString());

  } catch (error) {
    console.error("Erreur GPT:", error);
    
    const gatherOptions = {
      input: "speech",
      speechTimeout: "auto",
      action: "/process",
      method: "POST",
      language: "fr-FR"
    };

    const text = "Une erreur est survenue. Pouvez-vous répéter votre demande s'il vous plaît ?";
    const twiml = await createTwiMLWithSpeech(text, gatherOptions);
    
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

app.listen(port, () => {
  console.log(`Standard téléphonique Dream Team actif sur le port ${port}`);
});