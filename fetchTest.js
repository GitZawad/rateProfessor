async function testFetch() {
    const fetch = (await import('node-fetch')).default;
    
    try {
        const response = await fetch('https://api.openai.com/v1/engines', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer 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`
            }
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Fetch request successful:', data);
    } catch (error) {
        console.error('Fetch request failed:', error);
    }
}

testFetch();
