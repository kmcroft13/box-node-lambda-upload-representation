'use strict';

const Promise = require('bluebird');
const BoxSDK = require("box-node-sdk");

exports.handler = (event, context, callback) => {
    console.log(`Event: ${JSON.stringify(event, null, 2)}`);
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);

    //Get client_id and client_secret from environment variables
    const sdk = new BoxSDK({
        clientID: process.env.BOX_CLIENT_ID,
        clientSecret: process.env.BOX_CLIENT_SECRET,
    });

    Promise.promisifyAll(sdk);

    //Get authorization code and file ID from event
    //Query params from Box to API gateway URL
    const authCode = event.code;
    const fileId = event.fileId;
    const conversionType = event.conversionType;

    sdk.getTokensAuthorizationCodeGrantAsync(authCode, null)

        .then( (response) => {
            console.log(response);
            return response;
        })

        .then( (tokenInfo) => {
            return sdk.getBasicClient(tokenInfo.accessToken);
        })

        .then( (client) => {
            Promise.promisifyAll(client.files);
            return client.files.getAsync(fileId, {fields: 'id,name,parent,representations'}).then( (fileInfo) => {
                console.log(fileInfo);
                const result = {
                    client: client, 
                    fileInfo: fileInfo
                };
                return result;
            });
        })

        .then( (origFileInfo) => {

            const representations = origFileInfo.fileInfo.representations.entries;
            const parentId = origFileInfo.fileInfo.parent.id;
            const origFileName = origFileInfo.fileInfo.name;
            const client = origFileInfo.client;
            let representationAvailable = false;
            let repContentsUrl;
            let newFileName;

            for (let entry of representations) {
                if (entry.representation === conversionType) {
                    representationAvailable = true
                    repContentsUrl = entry.links.content.url;
                    if (conversionType == "pdf") {
                        newFileName = origFileName.substr(0, origFileName.lastIndexOf('.')) + ".pdf";
                    } else if (conversionType == "extracted_text") {
                        newFileName = origFileName.substr(0, origFileName.lastIndexOf('.')) + ".txt";
                    } else {
                        throw Error(`No ${conversionType} representation available for this file`);
                    }
                }
            }

            if (representationAvailable) {
                Promise.promisifyAll(client);
                return client.getAsync(repContentsUrl, null).then( (representationResponse) => {
                    //Buffer of file contents
                    console.log(representationResponse);
                    const result = { 
                        client: client,
                        newFileName: newFileName,
                        parentId: parentId,
                        fileBuffer: representationResponse.body
                    };
                    return result;
                });
            } else {
                throw Error(`No ${conversionType} representation available for this file`);
            }
        })

        .then( (newFileObject) => {
            const client = newFileObject.client;
            const newFileName = newFileObject.newFileName;
            const fileBuffer = newFileObject.fileBuffer;
            const parentId = newFileObject.parentId;
            Promise.promisifyAll(client.files);

            return client.files.uploadFileAsync(parentId, newFileName, fileBuffer).then( (newFileInfo) => {
                console.log(newFileInfo);
                const result = newFileInfo;
                return result;
            })
            .catch( (error) => {
                if (error.response && error.response.body) {
                    throw Error(`${error.response.body.message}.`);
                } else {
                    throw Error(`${error.message}`);
                }
            });
        })

        .then( (convertedFileInfo) => {
            console.log(convertedFileInfo);
            const result = `${convertedFileInfo.entries[0].name} successfully converted`;
            console.log(result);
            callback(null, result);
        })

        .catch( (error) => {
            console.log(error);
            const result = `An error occured while converting the file. ${error.message}`;
            console.log(result);
            callback(result, null);
        });

};
