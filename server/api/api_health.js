import { defineEventHandler } from 'h3';

export default defineEventHandler(async (event) => {
    try {
        const response = await fetch("https://ai.hackclub.com/up");

        if (!response.ok) {
            return { status: "down" };
        }

        const data = await response.json();
        return data;
    } catch (error) {
        return { status: "down" };
    }
});
