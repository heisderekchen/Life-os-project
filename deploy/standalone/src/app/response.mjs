const JSON_HEADERS = Object.freeze({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
});

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...JSON_HEADERS, ...extraHeaders }
    });
}

function apiErrorResponse(error) {
    const status = Number(error?.status) || 500;
    if (error?.code === 'DATABASE_NOT_READY') {
        return json({
            error: 'Database schema is not ready',
            code: 'DATABASE_NOT_READY'
        }, status >= 500 ? status : 503);
    }
    if (status >= 500) return json({ error: 'Internal server error' }, status);
    const body = { error: String(error?.message || 'Request failed') };
    if (error?.code) body.code = error.code;
    return json(body, status);
}

export { JSON_HEADERS, apiErrorResponse, json };
