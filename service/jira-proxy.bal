import ballerina/http;
import ballerina/io;
import ballerina/log;

public json properties = {};

public function main() {
    string filePath = "./properties.json";
    var rResult = readProperties(filePath);
        if (rResult is error) {
            log:printError("Error occurred while reading json: ",
                            err = rResult);
        } else if (rResult is json){

            properties = untaint rResult;
        }
}

function readProperties(string path) returns json|error {

    io:ReadableByteChannel rbc = io:openReadableFile(path);

    io:ReadableCharacterChannel rch = new(rbc, "UTF8");
    var result = rch.readJson();
    if (result is error) {
        closeRc(rch);
        return result;
    } else {
        closeRc(rch);
        return result;
    }
}

function closeRc(io:ReadableCharacterChannel rc) {
    var result = rc.close();
    if (result is error) {
        log:printError("Error occurred while closing character stream",
                        err = result);
    }
}

function callJira(string jql, string maxResults)  returns (json){

  http:Client clientEndpoint = new(<string> properties.jiraEndpoint, config = {
    auth: {
        scheme: http:BASIC_AUTH,
        username: <string> properties.jiraUsername,
        password: <string> properties.jiraPassword
    }
});

  log:printInfo("Calling JIRA API");
  http:Request req = new;

  var response = clientEndpoint->get("/rest/api/2/search?jql=" + jql + "&maxResults=" + maxResults + "&expand=changelog", message = req);
  log:printInfo("Received a response from JIRA API");

  return handleResponse(response);

}

function handleResponse(http:Response|error response) returns (json){
    if (response is http:Response) {
        var msg = response.getJsonPayload();
        if (msg is json) {
            return msg;
        } else {
          io:println(response);
          return {};
        }
    } else {
        io:println(response);
        return {};
    }
}

@http:ServiceConfig {
    cors: {
        allowOrigins: ["*"],
        allowCredentials: false,
        allowHeaders: ["*"],
        exposeHeaders: ["X-CUSTOM-HEADER"],
        maxAge: 84900
    }
}
service jiraProxy on new http:Listener(9092) {

    string respErr = "Failed to respond to the caller";
    @http:ResourceConfig {
        methods: ["POST"],
        path: "/search"
    }
    resource function search(http:Caller caller, http:Request req) {

        var params = req.getFormParams();

        if (params is map<string>){
          var jql = <string>params.jql;
          var maxResults = <string>params.maxResults;
          http:Response res = new;
          json responseJson = untaint callJira(jql, maxResults);
          res.setJsonPayload(responseJson);
          var result = caller->respond(res);
          if (result is error) {
             log:printError(result.reason(), err = result);
          }else{
            log:printInfo("Responded to the client.");
          }
        }
    }
}
