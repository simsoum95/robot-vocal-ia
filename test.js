const axios = require('axios');

(async () => {
  try {
    const response = await axios.post('http://localhost:3000/voice', {
      SpeechResult: "Quel est le but de la vie ?"
    });

    console.log("💬 Réponse XML de Twilio :\n");
    console.log(response.data);
  } catch (error) {
    console.error("❌ Erreur :", error.message);
  }
})();
