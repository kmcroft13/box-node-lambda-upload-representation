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

    //Convert box-node-sdk functions to Promises
    Promise.promisifyAll(sdk);

    //Get variables from event
    //Query params from Box callback URL -> AWS API gateway -> AWS Lambda
    const authCode = event.code; //Authorization code for the user invoking the integration
    const fileId = event.fileId; //File ID that the integrationw as invoked upon
    const conversionType = event.conversionType; //conversionType that the user chose from the integration popup

    //Get tokens from auth code passed from webapp integration callback
    sdk.getTokensAuthorizationCodeGrantAsync(authCode, null)

        .then( (response) => {
            console.log(response);
            return response;
        })

        //Create basic BoxSDK client with tokens
        .then( (tokenInfo) => {
            return sdk.getBasicClient(tokenInfo.accessToken);
        })

        //Get info about the Box file that the integration was invoked upon
        .then( (client) => {
            Promise.promisifyAll(client.files);
            return client.files.getAsync(fileId, {fields: 'id,name,parent,representations'}).then( (fileInfo) => {
                console.log(`File info: \n ${fileInfo}`);
                const result = {
                    client: client, 
                    fileInfo: fileInfo
                };
                return result;
            });
        })

        //Check for available representation and get buffer of representation file contents
        .then( (origFileInfo) => {
            const representations = origFileInfo.fileInfo.representations.entries;
            const parentId = origFileInfo.fileInfo.parent.id;
            const origFileName = origFileInfo.fileInfo.name;
            const client = origFileInfo.client;
            Promise.promisifyAll(client);
            let representationAvailable = false;
            let repContentsUrl;
            let newFileName;

            //Loop through representation entries and find a match for conversionType chosen by user
            for (let entry of representations) {
                if (entry.representation === conversionType) {
                    representationAvailable = true //Found a match
                    repContentsUrl = entry.links.content.url; //URL for representation file contents
                    
                    //Remove original file extension and apply new extension for converted file
                    if (conversionType == "pdf") {
                        newFileName = origFileName.substr(0, origFileName.lastIndexOf('.')) + ".pdf";
                    } else if (conversionType == "extracted_text") {
                        newFileName = origFileName.substr(0, origFileName.lastIndexOf('.')) + ".txt";
                    } else {
                        throw Error(`No handler for ${conversionType} conversions`);
                    }
                }
            }

            //Matching representation found. Get representation file contents.
            if (representationAvailable) {
                return client.getAsync(repContentsUrl, null).then( (representationResponse) => {
                    //Buffer of file contents
                    console.log(`Representation info: \n ${representationResponse}`);
                    const result = { 
                        client: client,
                        newFileName: newFileName, //File name with new extension
                        parentId: parentId, //Parent folder of original file
                        fileBuffer: representationResponse.body //Representation contents
                    };
                    return result;
                });
            } else {
                throw Error(`No ${conversionType} representation available for this file`);
            }
        })

        //Upload the representation to Box as a new file
        .then( (newFileObject) => {
            const newFileName = newFileObject.newFileName;
            const fileBuffer = newFileObject.fileBuffer;
            const parentId = newFileObject.parentId;
            const client = newFileObject.client;
            Promise.promisifyAll(client.files);

            return client.files.uploadFileAsync(parentId, newFileName, fileBuffer).then( (newFileInfo) => {
                console.log(`Uploaded file info: \n ${newFileInfo}`);
                const result = newFileInfo;
                return result;
            })
            //Catch upload errors to return friendly message to client
            .catch( (error) => {
                //If Box error response, throw Node error with Box response as message
                if (error.response && error.response.body) {
                    throw Error(`${error.response.body.message}.`);
                } else {
                    throw Error(`${error.message}`);
                }
            });
        })

        //Lambda success callback with message to return to AWS API gateway and Box webapp
        .then( (convertedFileInfo) => {
            const result = `${convertedFileInfo.entries[0].name} successfully converted`;
            console.log(result);
            callback(null, result);
        })

        //Lambda error callback with message to return to AWS API gateway and Box webapp
        .catch( (error) => {
            console.log(error);
            const result = `An error occured while converting the file. ${error.message}`;
            console.log(result);
            callback(result, null);
        });
};
