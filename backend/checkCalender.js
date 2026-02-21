const axios = require("axios");
require("dotenv").config();


async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const { data } = await axios.post("https://oauth2.googleapis.com/token", params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return data.access_token; // store + reuse until expires_in
}

const main = async() => {
  const token = await getAccessToken();
  console.log(token);
}

main();