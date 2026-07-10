const GCP_API_KEY = 'AIzaSyCiW2tvu5BsKPkv92aZpL0L-_BXpuep_nU';

async function testVision() {
    const visionPayload = {
        requests: [{
            image: { content: 'dGVzdA==' }, // dummy base64
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }]
        }]
    };

    try {
        const res = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${GCP_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visionPayload)
            }
        );
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Fetch error:", e);
    }
}

testVision();
