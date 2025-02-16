const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cheerio = require("cheerio");
const axios = require("axios");
const app = express();
const qs = require("qs");

app.use(express.json());

app.post("/v2/serper", async (req, res) => {
  const { message } = req.body;
  console.log("Got message: ", message);

  try {
    // Step 1: Fetch search results
    const serpApiConfig = {
      method: "post",
      url: "https://google.serper.dev/images",
      headers: {
        "X-API-KEY": process.env.SERP_API_PERPLEXITY,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ q: message, num: "50" }),
    };

    const serpResponse = await axios(serpApiConfig);
    console.log("Got Serper Responses: ");

    const { images } = serpResponse.data;
    console.log("Images");

    const processSources = async (images) => {
      const validateImageLink = async (url) => {
        try {
          const response = await axios.head(url, { timeout: 2000 });
          return response.status === 200;
        } catch {
          return false;
        }
      };

      const fetchPageContent = async (link) => {
        try {
          const response = await axios.get(link, { timeout: 5000 });
          const $ = cheerio.load(response.data);

          $("script, style, noscript, iframe, link, meta, a").remove();

          const content = $("body")
            .text()
            .replace(/\s+/g, " ")
            .replace(/[\[\]\(\)]+/g, "")
            .replace(/[^\w\s.,!?-]/g, " ")
            .trim()
            .split(/\s+/)
            .slice(0, 100)
            .join(" ");

          return content;
        } catch (error) {
          console.error(`Failed to fetch content for ${link}:`, error.message);
          return "";
        }
      };

      // Process images: Validate image first, then fetch content only if valid
      const processedSources = (
        await Promise.allSettled(
          images.map(async (item) => {
            const isAccessible = await validateImageLink(item.imageUrl || "");
            if (!isAccessible) return null; // Skip fetching content if image is invalid

            return {
              title: item.title || "No Title",
              link: item.link || "",
              image: item.imageUrl || "",
              searchResults: await fetchPageContent(item.link || ""),
            };
          })
        )
      )
        .filter(
          (result) => result.status === "fulfilled" && result.value !== null
        )
        .map((result) => result.value)
        .slice(0, 10);
      res.status(200).json({ sourcesWithContent: processedSources });
    };
  } catch (error) {
    console.error("Error processing request:", error.message);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
      sourcesWithContent: [],
    });
  }
});

async function genImage(prompt, authorization) {
  const model = "dall-e-3";
  const n = 1;
  const size = "1024x1024";
  const response = await axios.post(
    "https://api.openai.com/v1/images/generations",
    { model, prompt, n, size },
    {
      headers: {
        Authorization: `Bearer ${authorization}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

async function validateImageUrl(url) {
  try {
    const response = await axios.head(url);
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

app.post("/generate-image", async (req, res) => {
  const { prompt, authorization } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!authorization) {
    return res.status(401).json({ error: "Authorization is required" });
  }

  try {
    const response = await genImage(prompt, authorization);
    const imageData = response.data[0];
    const imageUrl = imageData.url.replace(/\\u0026/g, "&");

    res.status(200).json({ images: imageUrl });
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: "Unexpected error occurred" });
    }
  }
});

const BASE_URL = "https://twitter154.p.rapidapi.com";

// Endpoint: /search/search
app.get("/search/search", async (req, res) => {
  const {
    query,
    section = "latest",
    language = "en",
    limit = 25,
    min_likes = 0,
    min_retweets = 0,
  } = req.query;

  if (!query) {
    return res.status(400).json({ error: "Search query is required." });
  }

  try {
    const { "x-rapidapi-host": host, "x-rapidapi-key": key } = req.headers;

    if (!host || !key) {
      return res.status(400).json({
        error:
          "Required headers 'X-RapidAPI-Host' and 'X-RapidAPI-Key' are missing.",
      });
    }

    const response = await axios.get(`${BASE_URL}/search/search`, {
      headers: {
        "X-RapidAPI-Host": host,
        "X-RapidAPI-Key": key,
      },
      params: { query, section, language, limit, min_likes, min_retweets },
    });
    console.log(response.data);
    const array = response.data.results;
    const ans = array.map((result) => ({ text: result.text }));
    res.json(ans);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch tweets." });
  }
});

app.get("/user/details", async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  try {
    const { "x-rapidapi-host": host, "x-rapidapi-key": key } = req.headers;

    if (!host || !key) {
      return res.status(400).json({
        error:
          "Required headers 'X-RapidAPI-Host' and 'X-RapidAPI-Key' are missing.",
      });
    }
    const response = await axios.get(`${BASE_URL}/user/details`, {
      headers: {
        "X-RapidAPI-Host": host,
        "X-RapidAPI-Key": key,
      },
      params: { username },
    });
    res.json(response.data);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch user details." });
  }
});

app.get("/user/tweets", async (req, res) => {
  const { username, limit = 25, include_pinned = false } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  try {
    const { "x-rapidapi-host": host, "x-rapidapi-key": key } = req.headers;

    if (!host || !key) {
      return res.status(400).json({
        error:
          "Required headers 'X-RapidAPI-Host' and 'X-RapidAPI-Key' are missing.",
      });
    }
    const response = await axios.get(`${BASE_URL}/user/tweets`, {
      headers: {
        "X-RapidAPI-Host": host,
        "X-RapidAPI-Key": key,
      },
      params: { username, limit, include_pinned },
    });
    const array = response.data.results;
    const ans = array.map((result) => ({ text: result.text }));
    res.json(ans);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Failed to fetch user tweets." });
  }
});

// Step 2: Handle callback and exchange code for access token
app.get("/callback", async (req, res) => {
  const CLIENT_SECRET = process.env.LINK_CLIENT_SECRET;
  const REDIRECT_URI = process.env.LINK_REDIRECT_URI;
  const CLIENT_ID = process.env.LINK_CLIENT_ID;
  const authorizationCode = req.query.code;
  console.log("authorizationCode: ", authorizationCode);

  if (!authorizationCode) {
    return res.status(400).send("Authorization code not found");
  }

  console.log("Redirect URI: ", decodeURIComponent(REDIRECT_URI));

  const maxRetries = 15; // Maximum retry attempts
  const baseDelay = 500; // Base delay in milliseconds for exponential backoff
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      // Attempt to exchange authorization code for access token
      const tokenResponse = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        qs.stringify({
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: decodeURIComponent(REDIRECT_URI),
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const accessToken = tokenResponse.data.access_token;
      console.log("Access token:", accessToken);

      // Send the access token to the client
      return res.json({ accessToken });
    } catch (error) {
      attempt++;

      // Log error details
      console.error(`Attempt ${attempt} failed:`, error.message);

      // Check if the error is retryable
      if (error.response && error.response.status === 429) {
        console.warn("Rate limit reached, retrying...");
      } else if (!error.response) {
        console.warn("Network error, retrying...");
      } else {
        console.error(
          "Non-retryable error:",
          error.response?.data || error.message
        );
        break; // Exit loop for non-retryable errors
      }

      // Wait before the next attempt
      const delay = baseDelay * 2 ** (attempt - 1); // Exponential backoff
      console.log(`Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // If all attempts fail, respond with an error
  res.status(500).send("Failed to obtain access token after multiple attempts");
});

const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.post("/send-email", async (req, res) => {
  console.log(req.body);
  const { to, subject, text } = req.body;

  if (!to || !subject || !text) {
    return res
      .status(400)
      .send({ error: "Missing required fields: to, subject, text" });
  }

  try {
    const emails = to.split(",").map((email) => email.trim());

    const emailTemplate = (content) => `
      <html>
      <body>
        <div style="text-align: center;">
          <img src="https://ci3.googleusercontent.com/meips/ADKq_NZZwrETAW64SJnSb_Mh-ILdbu_g2lYz1iKDn-Vt79K-nnZ70R9U43AzoL0RmQ2nwAE9KzehyLpXTbkQu9c7LXBAastc3AWGeBGegCIVrXIj4AIs7ZX3u_lEJcruXsYvW4wmZrS0ScpTUTKUNLNInXO_=s0-d-e1-ft#https://bruy2.img.a.d.sendibm1.com/im/sh/GilWH-kN7GhR.png?u=7xwQLFBtniwQn1M8MygQlvy3YBBwTTy" alt="Banner" style="max-width: 100%; height: auto;">
        </div>
        <div style="padding: 20px; font-family: Arial, sans-serif; font-size: 16px;">
          ${content}
        </div>
        <div style="background-color: #000000; padding: 20px; color: #fdfcff; text-align: center; font-family: Montserrat, Arial; font-size: 14px;">
          <strong>AIREV - OnDemand</strong><br>
          1301-1302, Al Shatha Tower, Dubai Internet City, Dubai, United Arab Emirates<br>
         <p>You've received this email because you've subscribed to our newsletter.</p>
          <p><a href="https://bruy2.r.a.d.sendibm1.com/mk/un/sh/SMJz09a0vkbXq4etnoibeVBr8LtW/30WapXesmVLl" style="color: #fdfcff; text-decoration: underline;">Unsubscribe</a></p>
        </div>
      </body>
      </html>
    `;

    await Promise.all(
      emails.map((email) => {
        const msg = {
          to: email,
          from: "on-demand <info@on-demand.io>",
          subject: subject,
          text: text,
          html: emailTemplate(text),
        };
        return sgMail.send(msg);
      })
    );

    return res.status(200).json({
      message: `Email has been sent successfully to the provided ${to}`,
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: "Error sending email",
      error: error.message,
    });
  }
});

app.get("/getkeywordanalysis", async (req, res) => {
  try {
    let { keyword } = req.query;
    console.log(keyword);

    keyword = encodeURIComponent(keyword);

    console.log("After url encoded ", keyword);

    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: `https://semrush-keyword-magic-tool.p.rapidapi.com/global-volume?keyword=${keyword}`,
      headers: {
        "x-rapidapi-host": "semrush-keyword-magic-tool.p.rapidapi.com",
        "x-rapidapi-key": process.env.KEYWORD_SEARCH,
      },
    };

    const response = await axios.request(config);
    const data = response.data["Global Keyword Data"][0];
    return res.status(200).json(data);
  } catch (error) {
    console.log("Error ", error);
    return res.status(500).json({ data: "Some went wrong" });
  }
});

app.listen(3000, () => {
  console.log("Server is listening on port 3000");
});
