import { defineEventHandler, getQuery } from 'h3';

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const config = useRuntimeConfig();
    const apiKey = config.hackclubSearchApiKey;

    if (!apiKey) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Search API key is not configured.'
        });
    }

    const {
        q,
        count = 20,
        offset = 0,
        safesearch = 'moderate',
        freshness
    } = query;

    if (!q) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Query parameter "q" is required.'
        });
    }

    try {
        const searchUrl = new URL('https://search.hackclub.com/res/v1/web/search');
        searchUrl.searchParams.append('q', q);
        searchUrl.searchParams.append('count', Math.min(count, 20).toString());
        searchUrl.searchParams.append('offset', Math.min(offset, 9).toString()); // API max offset is 9 for pages
        searchUrl.searchParams.append('safesearch', safesearch);
        if (freshness) {
            searchUrl.searchParams.append('freshness', freshness);
        }

        const response = await fetch(searchUrl.toString(), {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw createError({
                statusCode: response.status,
                statusMessage: `Search API failed: ${response.statusText}`
            });
        }

        const data = await response.json();
        return data;

    } catch (error) {
        console.error('Search API Error:', error);
        throw createError({
            statusCode: error.statusCode || 500,
            statusMessage: error.statusMessage || 'Internal Server Error'
        });
    }
});
