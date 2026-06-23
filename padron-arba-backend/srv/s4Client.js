const { getDestination } = require("@sap-cloud-sdk/connectivity");

function encodeFilterValue(value) {
    return String(value || "").replace(/'/g, "''");
}

function normalizeODataResults(payload) {
    if (!payload) return [];
    if (Array.isArray(payload.value)) return payload.value;
    if (payload.d && Array.isArray(payload.d.results)) return payload.d.results;
    if (payload.d) return [payload.d];
    return [];
}

function buildUrl(baseUrl, path, params) {
    const url = new URL(path, baseUrl.replace(/\/$/, "") + "/");

    Object.keys(params || {}).forEach(function (key) {
        url.searchParams.set(key, params[key]);
    });

    return url.toString();
}

function buildHeaders(destination, headers) {
    const finalHeaders = Object.assign({
        accept: "application/json"
    }, headers || {});

    if (destination.authentication === "BasicAuthentication" && destination.username && destination.password) {
        const token = Buffer.from(`${destination.username}:${destination.password}`).toString("base64");
        finalHeaders.authorization = `Basic ${token}`;
    }

    return finalHeaders;
}

async function getResolvedDestination(destinationName) {
    const destination = await getDestination({ destinationName });

    if (!destination) {
        throw new Error(`No se encontro el destino ${destinationName}`);
    }

    return destination;
}

async function requestRaw(destinationName, options) {
    const destination = await getResolvedDestination(destinationName);

    return fetch(buildUrl(destination.url, options.url, options.params), {
        method: options.method || "GET",
        headers: buildHeaders(destination, options.headers),
        body: options.data ? JSON.stringify(options.data) : options.body
    });
}

async function request(destinationName, options) {
    const response = await requestRaw(destinationName, options);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const error = new Error(`HTTP ${response.status} llamando a ${destinationName}`);
        error.response = { data, text };
        throw error;
    }

    return data;
}

function getResponseCookies(response) {
    if (typeof response.headers.getSetCookie === "function") {
        return response.headers.getSetCookie();
    }

    const cookie = response.headers.get("set-cookie");
    return cookie ? [cookie] : [];
}

function toCookieHeader(cookies) {
    return cookies.map(function (cookie) {
        return cookie.split(";")[0];
    }).join("; ");
}

async function fetchCsrfToken(destinationName, serviceRoot) {
    const response = await requestRaw(destinationName, {
        method: "GET",
        url: serviceRoot,
        headers: {
            "x-csrf-token": "Fetch",
            accept: "application/json"
        }
    });

    const token = response.headers.get("x-csrf-token");
    const cookie = toCookieHeader(getResponseCookies(response));

    if (!response.ok || !token) {
        throw new Error(`No se pudo obtener CSRF token para ${destinationName}: ${await response.text()}`);
    }

    return { token, cookie };
}

module.exports = {
    encodeFilterValue,
    normalizeODataResults,
    request,
    requestRaw,
    fetchCsrfToken
};
