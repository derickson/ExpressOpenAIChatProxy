import axios from "axios";
import { Configuration, OpenAIApi } from "openai";
import { streamCompletion, generateId, getOpenAIKey, getAzureAIDeployment } from "./functions.js"
import { DEBUG, CACHING_ENABLED } from "./config.js";


async function adaptOpenAIModels(req,res) {
    return res.status(501).send({
        status: false,
        error: "This proxy does not implement that function"
    });
};

async function adaptOpenAICompletion(req,res) {
    return res.status(501).send({
        status: false,
        error: "This proxy does not implement that function"
    });
};


const MAX_CACHE_SIZE = 100;
const responseCache = {};
const recentResponses = [];

function addToCache(question, response) {
    const str_question = JSON.stringify(question);
    responseCache[str_question] = response;
    recentResponses.unshift(str_question);
    if(recentResponses.length > MAX_CACHE_SIZE) {
        const removedQuestion = recentResponses.pop();
        delete responseCache[removedQuestion];
    }
}

function getFromCache(question){
    const str_question = JSON.stringify(question);
    return responseCache[str_question];

}


async function adaptOpenAIChatCompletion(req, res) {
    
    // Attempt to cache answer
    if(CACHING_ENABLED && !req.body.stream){
        const cache_reponse = getFromCache(req.body);
        if(cache_reponse){
            if(DEBUG) console.log("  Returning cached reponse")
            return res.status(200).send(cache_reponse.data);
        }
    }

    // OpenAI incoming to Azure outgoing chat completion
    let deployment = null;
    try {
        deployment = getAzureAIDeployment();
    } catch (e) {
        return res.status(429).send({
            status: false,
            error: "Too many requests, please try again later"
        });
    }

    let orgId = generateId();
    let key = deployment["api_key"];

    // const new_url = deployment["api_key"] + req.url;
    const base_url = deployment["api_base"];
    const deployment_name = deployment["deployment_name"];
    const api_version = deployment["api_version"];
    const new_url = base_url + "/openai/deployments/" + deployment_name + "/chat/completions?api-version=" + api_version;

    res['deployment_name'] = deployment_name;

    if (req.body.stream) {
        try {
            const response = await axios.post(
                new_url, req.body,
                {
                    responseType: "stream",
                    headers: {
                        Accept: "text/event-stream",
                        "Content-Type": "application/json",
                        "api-key": key,
                    },
                },
            );

            res.setHeader("content-type", "text/event-stream");

            for await (const message of streamCompletion(response.data)) {
                try {
                    const parsed = JSON.parse(message);
                    delete parsed.id;
                    delete parsed.created;
                    const { content } = parsed.choices[0].delta;
                    if (content) {
                        res.write(`data: ${JSON.stringify(parsed)}\n\n`);
                    }
                } catch (error) {
                    if (DEBUG) console.error("Could not JSON parse stream message", message, error);
                }
            }

            res.write(`data: [DONE]`);
            deployment.semaphore.release();
            res.end();
        } catch (error) {
            try {
                if (error.response && error.response.data) {
                    let errorResponseStr = "";

                    for await (const message of error.response.data) {
                        errorResponseStr += message;
                    }

                    errorResponseStr = errorResponseStr.replace(/org-[a-zA-Z0-9]+/, orgId);

                    const errorResponseJson = JSON.parse(errorResponseStr);
                    deployment.semaphore.release();
                    return res.status(error.response.status).send(errorResponseJson);
                } else {
                    if (DEBUG) console.error("Could not JSON parse stream message", error);
                    deployment.semaphore.release();
                    return res.status(500).send({
                        status: false,
                        error: "sProxy Server Error"
                    });
                }
            }
            catch (e) {
                if (DEBUG) console.log(e);
                deployment.semaphore.release();
                return res.status(500).send({
                    status: false,
                    error: "Proxy Server Error"
                });
            }
        }
    }
    else {
        try {

            const response = await axios.post(
                new_url, req.body,
                {
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "api-key": key,
                    },
                },
            );

            if(CACHING_ENABLED) addToCache(req.body, response);

            delete response.data.id;
            delete response.data.created;
            deployment.semaphore.release();
            return res.status(200).send(response.data);
        } catch (error) {
            try {
                
                if (axios.isAxiosError(error)) {
                // This is an AxiosError, you can handle it here
                    console.error('Axios Error:', error.message);
                    console.error('Status Code:', error.response?.status);
                    console.error('Response Data:', error.response?.data);

                } else {
                // This is a regular JavaScript Error, handle it accordingly
                    console.error('Error:', error.message);
                }
                deployment.semaphore.release();

                if(error.response?.status && error.response?.data){
                    error.response.data.error.message = error.response.data.error.message.replace(/org-[a-zA-Z0-9]+/, orgId);
                    return res.status(error.response.status).send(error.response.data);
                } else {
                    return res.status(500).send({
                        status: false,
                        error: "Proxy Server Error"
                    });
                }
                
            }
            catch (e) {
                if (DEBUG) console.log(e);
                deployment.semaphore.release();
                return res.status(500).send({
                    status: false,
                    error: "Proxy Server Error"
                });
            }
        }
    }

}

export { 
    adaptOpenAIModels,
    adaptOpenAICompletion,
    adaptOpenAIChatCompletion
};