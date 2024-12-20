const express = require("express");
const dotenv = require("dotenv");
dotenv.config();
const cheerio = require("cheerio");
const axios = require("axios");
const app = express();

app.use(express.json());

app.post("/v2/serper", async (req, res) => {
  const { message } = req.body;

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
    const { images } = serpResponse.data;

    // Step 2: Parse sources
    const sourcesParsed = images.map((item) => ({
      title: item.title || "No Title",
      link: item.link || "",
      image: item.imageUrl || "",
    }));

    // Step 3: Fetch page content
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

        return { content, link };
      } catch (error) {
        console.error(`Failed to fetch content for ${link}:`, error.message);
        return { content: "", link };
      }
    };

    // Step 4: Process content
    const processAndVectorizeContent = async (item) => {
      const { content } = await fetchPageContent(item.link);
      return { ...item, searchResults: content };
    };

    // Step 5: Process all sources
    const sourcesWithContent = (
      await Promise.allSettled(sourcesParsed.map(processAndVectorizeContent))
    )
      .filter(
        (result) => result.status === "fulfilled" && result.value.searchResults
      )
      .map((result) => result.value)
      .slice(0, 10);

    // Step 6: Prepare messages for summarization
    // const summarizedMap = [
    //   {
    //     role: "system",
    //     content: "You are a summarizer which summarizes in 100 words.",
    //   },
    //   ...sourcesWithContent.map((item) => ({
    //     role: "user",
    //     content: item.searchResults,
    //   })),
    // ];

    // // Step 7: Summarize content
    // const summarizedResponses = await summarizeContent(summarizedMap);

    // // Step 8: Update sources with summarized content
    // summarizedResponses.forEach((summary, index) => {
    //   sourcesWithContent[index].searchResults = summary.message.content;
    // });

    // Step 9: Send response
    res.status(200).json({ sourcesWithContent });
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
    let isValid = false;
    let images;

    while (!isValid) {
      const response = await genImage(prompt, authorization);
      const imageData = response.data[0];
      const imageUrl = imageData.url;

      isValid = await validateImageUrl(imageUrl);

      if (isValid) {
        images = response; // Store valid image response
      }
    }

    res.status(200).json({ images });
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: "Unexpected error occurred" });
    }
  }
});

app.listen(3000, () => {
  console.log("Server is listening on port 3000");
});
