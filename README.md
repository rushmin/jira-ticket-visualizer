# JIRA Ticket Visualizer


## What does it do ?

It visualizes the timeline of stage changes of tickets. This is helpful identify the health of the tickets.

## Components of the application

### Web application

The web application contains the web resources (HTML, Javascript and CSS files) which are used to render the timeline of tickets. It is at the ```web``` directory. These resources can be deployed in any web server as there are no server side web components.


### JIRA proxy service

The web application's client side Javascript code needs to call the JIRA API to fetch the ticket details. Due to CORS limitation this call might not be possible. Therefore there is a simple proxy service which comes with the application. It relaxes the CORS rules. The proxy service has been written in [Ballerina](https://ballerina.io/) which is a cloud native programming language.

The proxy service is located inside the ```service``` directory.



## Deploying the application


1) Start the JIRA Proxy

	 1. Create the configuration properties file by duplicating the ```properties.json.template``` file. The name of the new file should be ```properties.json```
	 2. Configure the properties. The purpose of each property is listed below.
		 - jiraEndpoint
		   The base path of the JIRA API. e.g. https://wso2.org/jira where as an API resource path is https://wso2.org/jira/rest/api/2/search
		  - jiraUsername
			  Username of a JIRA account
		  - jiraPassword
		    Password of the above JIRA account
    3. Start the proxy service with the command below.
```
ballerina run jira-proxy.bal
```


2) Start the web application

	1. Configure the JIRA proxy service
The endpoint information of the proxy service is configured in ```properties.js ``` file.
	2. Start the web server



## Visualizing the tickets


1) Load the web application

```index.html``` of the web application is the starting point.

2) Enter the parameters

* **JQL** - The Jira query which returns the list of tickets to be visualized.
* **Max. Results** - By default JIRA returns only the first 50 records of a search results. The parameter is used to the controlled the number of returned results.
* **Duration** - The visualization is based on the current timestamp. The ```duration``` parameter controlls the time period which the visualization is needed. e.g. last two weeks.
A few samples for the duration parameter are, ```1 week```, ```6 days```, ```2 months```

3) Upon clicking on the the ```Draw Graph``` button, the web application will fetch the tickets from JIRA and draw the graph. This might take a while depending on the latency of the JIRA server and number of records being fetched.
