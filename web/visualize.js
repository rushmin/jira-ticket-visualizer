var SCORE_SCHEME = {"severity":{"L1":50,"L2":40,"L3":30,"Q":5,"B":10,"H":5,"A":5,"S":5,"T":5},
                     "status":{"3":20, "10002":50, "1":100, "4":100},
                     "age":0.1,
                     "ageInCurrentStatus":0.2,
                     "ageWithoutPublicComment":0.3
                   };

var SETTINGS;

var PRODUCTS = ["APIM", "IAM", "EI", "Analytics", "OB", "ALL"];
var GAUGE_CHART_STATUS_CODES = ["1", "3", "10002"];

var PRODUCT_OF_TAG = {"apim":"APIM", "iam":"IAM", "is":"IAM", "esb":"EI", "ei":"EI", "das":"Analytics", "ob":"OB"};

var GAUGE_CHARTS = {};

var TICKET_COUNT_CHARTS = {};

var WORKLOAD_CHARTS = {};

var GAUGE_CHART_OPTIONS = {'1':{
                                  width: 125, height: 125,
                                  redFrom: 3, redTo: 24,
                                  yellowFrom:1, yellowTo: 3,
                                  greenFrom:0, greenTo: 1,
                                  max:24,
                                  minorTicks: 5
                                },
                           '3':{
                                   width: 125, height: 125,
                                   redFrom: 5, redTo: 24,
                                   yellowFrom:3, yellowTo: 5,
                                   greenFrom:0, greenTo: 3,
                                   max:24,
                                   minorTicks: 5
                                },
                           '10002':{
                                   width: 125, height: 125,
                                   redFrom: 4, redTo: 24,
                                   yellowFrom:2, yellowTo: 4,
                                   greenFrom:0, greenTo: 2,
                                   max:24,
                                   minorTicks: 5
                                 }
                          };


var timelineChart;
var workloadTimelineChart;
var avgInProgressGaugeChart;
var avgWowGaugeChart;
var avgOpenGaugeChart;

google.charts.load("current", {packages:["timeline", "corechart", 'gauge', 'bar']});

var endDateTime;
var visualizationDuration;
var startDateTime;

$("#drawGraph").click(function() {
  var tickets = loadTickets(loadTicketCallback);
});

setInterval(function() {
  init();
  loadTickets(loadTicketCallback);
}, 30000);

function init(){
  SETTINGS = {jql:$("#jql").val(),
                  maxResults:$("#maxResults").val(),
                  startAt:$("#startAt").val(),
                  duration:$("#duration").val(),
                  apiUrl:$("#apiUrl").val(),
                  apiTimeout:$("#apiTimeout").val(),
                  ticketType:$("#ticketType").val()}
}

function loadTicketCallback(tickets){

  visualizationDuration = SETTINGS.duration;

  var durationExpressionElements = visualizationDuration.split(" ");
  endDateTime = new Date();
  startDateTime = moment(endDateTime).subtract(parseInt(durationExpressionElements[0]), durationExpressionElements[1]);

  var duration = endDateTime - startDateTime;

  var processedTickets = processTickets(tickets);

  var aggregatedStats = aggregateStats(processedTickets);

  var timelineChartData = buildTimelineChartData(processedTickets);

  var workloadTimelineChartData = buildWorkloadTimelineChartData(processedTickets);

  drawTimelineChart(timelineChartData);
  drawGaugeChart(aggregatedStats, duration);
  drawWorkloadTimeline(workloadTimelineChartData);
}


function loadTickets(loadTicketCallback){
  return loadTicketsWithHTTP(loadTicketCallback);
}

function loadTicketsWithHTTP(loadTicketCallback){

  if(!SETTINGS.jql){
    return;
  }

  $.ajax({
    method: "POST",
    url: SETTINGS.apiUrl,
    data: {jql: SETTINGS.jql, maxResults: SETTINGS.maxResults, startAt: SETTINGS.startAt},
    timeout: SETTINGS.apiTimeout
  })
  .done(function( response ) {
    loadTicketCallback.call(this, response)
  }).fail(function(data) {
    if ( data.responseCode )
      console.log( data.responseCode );
  });

}

function processTickets(tickets){

  var events = buildEvents(tickets);
  var events = trimEvents(events, startDateTime);
  var timelines = buildTimelines(events);
  var processedTickets = extractInfoAndAppendTimeline(tickets, timelines);

  return processedTickets;
}

// Response format : [{ticketId:{info:{openHours etc ..}}, timeline:[]}, ... ]
function extractInfoAndAppendTimeline(tickets, timelines){

  var processedTickets = new Array();

  for(var i = 0; i < tickets.issues.length; i++){

    if(SETTINGS.ticketType !== "all" && tickets.issues[i].fields.issuetype.id !== SETTINGS.ticketType){
      continue;
    }

    //{ticketId:{stats:{openHours etc ..}}, events:[]}
    var ticket = new Object();

    ticket.ticketID = tickets.issues[i].key;
    ticket.timeline = timelines[ticket.ticketID];

    ticket.info = new Object();

    ticket.info.created = tickets.issues[i].fields.created;
    ticket.info.issueType = tickets.issues[i].fields.issuetype.name;
    ticket.info.products = getProductsOfTicket(tickets.issues[i]);

    // If the ticket is an incident, get the severity.
    if(tickets.issues[i].fields.issuetype.id === "5"){

      var severity = tickets.issues[i].fields.customfield_10020.value.toString();

      if(severity.includes("Serious")){
        ticket.info.severity = "L3";
      }else if(severity.includes("Urgent")){
        ticket.info.severity = "L2";
      }else if(severity.includes("Catastrophic")){
        ticket.info.severity = "L1";
      }else{
        ticket.info.severity = severity;
      }


    }else{
      ticket.info.severity = tickets.issues[i].fields.issuetype.name.charAt(0);
    }

    ticket.info.statusId = tickets.issues[i].fields.status.id;
    ticket.info.statusName = tickets.issues[i].fields.status.name;

    ticket.info.assignee = tickets.issues[i].fields.assignee.displayName;

    // If the ticket is not in the 'Open' state, get state change information.
    if(ticket.info.statusId !== "1"){
      ticket.info.inCurrentStatusSince = timelines[ticket.ticketID][timelines[ticket.ticketID].length - 1]
                                          .from;
    }else{
      ticket.info.inCurrentStatusSince = ticket.info.created;
    }

    ticket.info.lastPublicCommentDate = tickets.issues[i].fields.customfield_10260;

    if(isNaN(new Date(ticket.info.lastPublicCommentDate).getTime())){
      ticket.info.lastPublicCommentDate = ticket.info.created;
    }

    ticket.score = calculateScore(ticket);

    processedTickets.push(ticket);
  }

  processedTickets.sort(compareScores);

  return processedTickets;
}

// Response format : [{ticketID: issue.key,events:[{date:<>,from:<>,to:<>}]}, ...]
function buildEvents(tickets){

  var events = new Array();

  for(var i = 0; i < tickets.issues.length; i++){

    var issue = tickets.issues[i];

    var statusChangelog = new Array();

    // Add ticket opening as an event. Non-existing --> Open
    statusChangelog.push({"date":issue.fields.created,
                          "from":"000",
                          "to":"1"})

    for(var j = 0; j < issue.changelog.histories.length; j++){

        for(var k = 0; k < issue.changelog.histories[j].items.length; k++){
          if(issue.changelog.histories[j].items[k].field === "status"){

            statusChangelog.push({"date":issue.changelog.histories[j].created,
                                  "from":issue.changelog.histories[j].items[k].from,
                                  "to":issue.changelog.histories[j].items[k].to})
          }
        }
      }

      events.push({ticketID: issue.key,events:statusChangelog});
  }

  return events;

}

// Events which were generated before the date marker (startDate) should be ommited.
// And a padding event should be added to the ticket which has started the life after the marker.
function trimEvents(ticketsWithEvents, startDate){

  var ticketsWithTrimmedEvents = new Array();

  for(var i = 0; i < ticketsWithEvents.length; i++){

    var trimmedEventsOfTicket = new Array();

    // If the marker is before the first event.
    if(new Date(ticketsWithEvents[i].events[0].date) > startDate){

      //Add the padding event for non-existing time period, if applicable.
      trimmedEventsOfTicket.push({date:startDate, from:"000", to:"000"});

      // Add the rest of the events.
      for(var j = 0; j < ticketsWithEvents[i].events.length; j++){
        trimmedEventsOfTicket.push(ticketsWithEvents[i].events[j]);
      }

    }else{

      var addedTrimmedEvent = false;
      for(var j = 0; j < ticketsWithEvents[i].events.length; j++){

        if(new Date(ticketsWithEvents[i].events[j].date) < startDate){
          // Omit the event
          if(j === ticketsWithEvents[i].events.length - 1){
            trimmedEventsOfTicket.push({date:startDate, from:ticketsWithEvents[i].events[j].from, to:ticketsWithEvents[i].events[j].to});
          }
        }else{

          if(addedTrimmedEvent){
            trimmedEventsOfTicket.push(ticketsWithEvents[i].events[j]);
          }else {
            var trimmedEvent = {date:startDate, from:ticketsWithEvents[i].events[j-1].from, to:ticketsWithEvents[i].events[j-1].to}
            trimmedEventsOfTicket.push(trimmedEvent);
            trimmedEventsOfTicket.push(ticketsWithEvents[i].events[j]);
            addedTrimmedEvent = true;
          }
        }
      }
    }

    if(trimmedEventsOfTicket.length > 0){
        ticketsWithTrimmedEvents.push({ticketID: ticketsWithEvents[i].ticketID,events:trimmedEventsOfTicket});
    }
  }

  return ticketsWithTrimmedEvents;
}

function buildTimelines(ticketsWithEvents){

  var timeline = new Object();

  for(var i = 0; i < ticketsWithEvents.length; i++){
    var timeslots = new Array();

    if(ticketsWithEvents[i].events.length === 0){
      continue;
    }

    for(var j = 0; j < ticketsWithEvents[i].events.length - 1; j++){

      timeslots.push({status:ticketsWithEvents[i].events[j].to, to:new Date(ticketsWithEvents[i].events[j+1].date), from:new Date(ticketsWithEvents[i].events[j].date)});
    }

    // Compute the last slot.
    var lastIndex = ticketsWithEvents[i].events.length - 1;
    timeslots.push({status:ticketsWithEvents[i].events[j].to, to:endDateTime, from:new Date(ticketsWithEvents[i].events[lastIndex].date)});
    timeline[ticketsWithEvents[i].ticketID] = timeslots;
  }

  return timeline;
}

function aggregateStats(tickets){

  var workload = {"APIM":{"incomingLoad":[], "responded":[], "attended":[]},
                       "IAM":{"incomingLoad":[], "responded":[], "attended":[]},
                       "EI":{"incomingLoad":[], "responded":[], "attended":[]},
                       "Analytics":{"incomingLoad":[], "responded":[], "attended":[]},
                       "OB":{"incomingLoad":[], "responded":[], "attended":[]},
                       "ALL":{"incomingLoad":[], "responded":[], "attended":[]}
                      }

  // Collect stats
  var ticketCountPerProduct = {"APIM":[],
                                "IAM":[],
                                "EI":[],
                                "Analytics":[],
                                "OB":[],
                                "ALL":[]
                                };

  var newTicketCountPerProduct = {"APIM":[],
                                "IAM":[],
                                "EI":[],
                                "Analytics":[],
                                "OB":[],
                                "ALL":[]
                                };

  var durations = {"APIM":{'1':[],'3':[],'4':[],'10002':[]},
                  "IAM":{'1':[],'3':[],'4':[],'10002':[]},
                  "EI":{'1':[],'3':[],'4':[],'10002':[]},
                  "Analytics":{'1':[],'3':[],'4':[],'10002':[]},
                  "OB":{'1':[],'3':[],'4':[],'10002':[]},
                  "ALL":{'1':[],'3':[],'4':[],'10002':[]}
                  };

  var slotCounts = {"APIM":{'1':[],'3':[],'4':[],'10002':[]},
                    "IAM":{'1':[],'3':[],'4':[],'10002':[]},
                    "EI":{'1':[],'3':[],'4':[],'10002':[]},
                    "Analytics":{'1':[],'3':[],'4':[],'10002':[]},
                    "OB":{'1':[],'3':[],'4':[],'10002':[]},
                    "ALL":{'1':[],'3':[],'4':[],'10002':[]}
                    };

  var ticketCounts = {"APIM":{'1':[],'3':[],'4':[],'10002':[]},
                    "IAM":{'1':[],'3':[],'4':[],'10002':[]},
                    "EI":{'1':[],'3':[],'4':[],'10002':[]},
                    "Analytics":{'1':[],'3':[],'4':[],'10002':[]},
                    "OB":{'1':[],'3':[],'4':[],'10002':[]},
                    "ALL":{'1':[],'3':[],'4':[],'10002':[]}
                    };


  for(var i = 0; i < tickets.length; i++){

    for(var x = 0; x < tickets[i].info.products.length; x++){
      ticketCountPerProduct[tickets[i].info.products[x]].push(1);
      if(ticketCounts[tickets[i].info.products[x]][tickets[i].info.statusId]){
          ticketCounts[tickets[i].info.products[x]][tickets[i].info.statusId].push(1);
      }
    }

    for(j = 0; j < tickets[i].timeline.length; j++){
      for(var k = 0; k < tickets[i].info.products.length; k++){
        if(durations[tickets[i].info.products[k]][tickets[i].timeline[j].status]){
            durations[tickets[i].info.products[k]][tickets[i].timeline[j].status].push(tickets[i].timeline[j].to - tickets[i].timeline[j].from);
        }
        if(slotCounts[tickets[i].info.products[k]][tickets[i].timeline[j].status]){
            slotCounts[tickets[i].info.products[k]][tickets[i].timeline[j].status].push(1);
        }
        if(tickets[i].timeline[j].status === "1"){
          newTicketCountPerProduct[tickets[i].info.products[k]].push(1);
        }

        var previousSlot = j === 0? null : tickets[i].timeline[j-1];
        var slot = tickets[i].timeline[j];
        var nextSlot = j === (tickets[i].timeline.length - 1)? null : tickets[i].timeline[j+1];

        if(isWorkloadSlot(previousSlot, slot, nextSlot)){
          workload[tickets[i].info.products[k]].incomingLoad.push(1);
        }

        if(previousSlot && slot.status === "10001" && previousSlot.status === "3"){
          // In-Progress -> WOC is consirdered as a responded occurance.
          workload[tickets[i].info.products[k]].responded.push(1);
        }

      }
    }
  }
  var stats = {durations:durations,
                ticketCounts:ticketCounts,
                slotCounts:slotCounts,
                totalTickets:tickets.length,
                ticketCountPerProduct:ticketCountPerProduct,
                newTicketCountPerProduct:newTicketCountPerProduct,
                workload:workload};

  console.log(stats);

  return stats;
}

function calculateScore(ticket){

  var score

  var score = SCORE_SCHEME.severity[ticket.info.severity]
              * SCORE_SCHEME.status[ticket.info.statusId]
              + (SCORE_SCHEME.age * Math.floor((new Date() - new Date(ticket.info.created)) / 36e5))
              + (SCORE_SCHEME.ageInCurrentStatus * Math.floor((new Date() - new Date(ticket.info.inCurrentStatusSince)) / 36e5))
              + (SCORE_SCHEME.ageWithoutPublicComment * Math.floor((new Date() - new Date(ticket.info.lastPublicCommentDate)) / 36e5));

  if (isNaN(score)){
    score = 0;
  }

  return score;

}

function compareScores(ticket1, ticket2){

  if (ticket1.score < ticket2.score) {
    return 1;
  }
  if (ticket1.score > ticket2.score) {
    return -1;
  }
  return 0;
}

function getProductsOfTicket(ticket){

  var products = new Set();

  var tags = ticket.fields.labels;

  for(var i = 0; i < tags.length; i++){
    if(PRODUCT_OF_TAG[tags[i].toLowerCase()]){
        products.add(PRODUCT_OF_TAG[tags[i].toLowerCase()]);
    }
  }

  products.add("ALL");

  return Array.from(products);
}


// --------- START : Graph functions --------------------

function buildTimelineChartData(tickets){

  var rows = new Array();

  for(var i = 0; i < tickets.length; i++){

    for(j = 0; j < tickets[i].timeline.length; j++){

      var row = new Array();

      row.push(tickets[i].ticketID);
      row.push(getSettingsForState(tickets[i].timeline[j].status).name);
      row.push(getSettingsForState(tickets[i].timeline[j].status).color);
      row.push(tickets[i].timeline[j].from);
      row.push(tickets[i].timeline[j].to);
      rows.push(row);
    }

  }
  return rows;
}

function buildWorkloadTimelineChartData(tickets){

  var rows = new Array();
  rows.push(['ID','Time','Duration','Status','Score']);

  for(var i = 0; i < tickets.length; i++){
    for(j = 0; j < tickets[i].timeline.length; j++){
      var row = new Array();

      var previousSlot = j === 0? null : tickets[i].timeline[j-1];
      var slot = tickets[i].timeline[j];
      var nextSlot = j === (tickets[i].timeline.length - 1)? null : tickets[i].timeline[j+1];

      if(isWorkloadSlot(previousSlot, slot, nextSlot)){
        row.push(tickets[i].ticketID);
        row.push(slot.from);
        row.push((slot.to - slot.from)/3600000);
        row.push(getSettingsForState(slot.status).name);
        row.push(tickets[i].score);
        rows.push(row);
      }
    }
  }

  return rows;

}

function drawTimelineChart(graphData){

  console.log(graphData);

  if(graphData.length === 0){
    return;
  }

  var container = document.getElementById('ticketTimeline');

  if(!timelineChart){
    timelineChart = new google.visualization.Timeline(container);
  }

  var dataTable = new google.visualization.DataTable();
  dataTable.addColumn({ type: 'string', id: 'Ticket' });
  dataTable.addColumn({ type: 'string', id: 'Status' });
  dataTable.addColumn({ type: 'string', id: 'style', role: 'style' });
  dataTable.addColumn({ type: 'date', id: 'Start' });
  dataTable.addColumn({ type: 'date', id: 'End' });
  dataTable.addRows(graphData);

  var options = {
      backgroundColor: '#fff',
      height: 1000
  };

  timelineChart.draw(dataTable, options);
}

function drawWorkloadTimeline(graphData){

  var container = document.getElementById('workloadTimeline');

  if(!workloadTimelineChart){
    workloadTimelineChart = new google.visualization.BubbleChart(container);
  }

  var dataTable = google.visualization.arrayToDataTable(graphData);

  var options = {
        hAxis: {title: 'Time'},
        vAxis: {title: 'Duration', logScale:true},
        bubble: {textStyle: {fontSize: 11}},
        height: 1000
      };

  workloadTimelineChart.draw(dataTable, options);
}


function drawGaugeChart(graphData, duration){

  for(var i = 0; i < PRODUCTS.length; i++){

    var workloadChart;
    if(WORKLOAD_CHARTS[PRODUCTS[i]]){
      workloadChart = WORKLOAD_CHARTS[PRODUCTS[i]];
    }else{
      workloadChart = new google.visualization.ColumnChart(document.getElementById(PRODUCTS[i] + '_workload'));
      WORKLOAD_CHARTS[PRODUCTS[i]] = workloadChart;
    }

    var incomingCount = graphData.workload[PRODUCTS[i]]['incomingLoad'].reduce(sum, 0);
    var respondedCount = graphData.workload[PRODUCTS[i]]['responded'].reduce(sum, 0);
    var attendedCount = respondedCount + graphData.ticketCounts[PRODUCTS[i]]['3'].reduce(sum, 0);

    $("#" + PRODUCTS[i] + "_respondingRatio").text((respondedCount/incomingCount).toFixed(2));
    $("#" + PRODUCTS[i] + "_attendingRatio").text((attendedCount/incomingCount).toFixed(2));

    var workloadChartData = google.visualization.arrayToDataTable([
         ['Status', 'Count'],
         ['W', incomingCount],
         ['R', respondedCount],
         ['A', attendedCount]
    ]);

    var workloadChartOptions = {
        width: 150,
        height: 150,
        bar: {groupWidth: "95%"},
        legend: { position: "none" },
      };

    workloadChart.draw(workloadChartData, workloadChartOptions);

    var ticketCountChart;
    if(TICKET_COUNT_CHARTS[PRODUCTS[i]]){
      ticketCountChart = TICKET_COUNT_CHARTS[PRODUCTS[i]];
    }else{
      ticketCountChart = new google.visualization.ColumnChart(document.getElementById(PRODUCTS[i] + '_tickets'));
      TICKET_COUNT_CHARTS[PRODUCTS[i]] = ticketCountChart;
    }

    var ticketCountChartData = google.visualization.arrayToDataTable([
         ['Status', 'Count'],
         ['Open', graphData.ticketCounts[PRODUCTS[i]]['1'].reduce(sum, 0)],
         ['WOW', graphData.ticketCounts[PRODUCTS[i]]['10002'].reduce(sum, 0)],
         ['In-Progress', graphData.ticketCounts[PRODUCTS[i]]['3'].reduce(sum, 0)]
    ]);

    var options = {
        width: 150,
        height: 150,
        bar: {groupWidth: "95%"},
        legend: { position: "none" },
      };

    ticketCountChart.draw(ticketCountChartData, options);

    $("#" + PRODUCTS[i] + "_count").text(graphData.ticketCountPerProduct[PRODUCTS[i]].reduce(sum, 0));
    $("#" + PRODUCTS[i] + "_newCount").text(graphData.newTicketCountPerProduct[PRODUCTS[i]].reduce(sum, 0));

    for(var j = 0; j < GAUGE_CHART_STATUS_CODES.length; j++){

      var chart;

      if(GAUGE_CHARTS[PRODUCTS[i]] && GAUGE_CHARTS[PRODUCTS[i]][GAUGE_CHART_STATUS_CODES[j]]){
        chart = GAUGE_CHARTS[PRODUCTS[i]][GAUGE_CHART_STATUS_CODES[j]];
      }else{
        chart = new google.visualization.Gauge(document.getElementById(PRODUCTS[i] + '_' + GAUGE_CHART_STATUS_CODES[j] + '_gauge'));

        if(!GAUGE_CHARTS[PRODUCTS[i]]){
          GAUGE_CHARTS[PRODUCTS[i]] = new Object();
        }
        GAUGE_CHARTS[PRODUCTS[i]][GAUGE_CHART_STATUS_CODES[j]] = chart;
      }

      var totalDuration = graphData.durations[PRODUCTS[i]][GAUGE_CHART_STATUS_CODES[j]].reduce(sum, 0);
      var totalCount = graphData.slotCounts[PRODUCTS[i]][GAUGE_CHART_STATUS_CODES[j]].reduce(sum, 0);

      var avgDuration = 0;

      if(totalCount > 0){
        avgDuration = totalDuration/ (3600000 * totalCount);
      }

      var data = google.visualization.arrayToDataTable([
              [''],
              [avgDuration]
        ]);
      var options = GAUGE_CHART_OPTIONS[GAUGE_CHART_STATUS_CODES[j]];
      chart.draw(data, options);

      $("#" + PRODUCTS[i] + "_" + GAUGE_CHART_STATUS_CODES[j] + "_slotsCount").text(totalCount);
    }
  }
}

function getSettingsForState(stateID){

  var settings = new Object();
  settings["1"] = {name:"Open", color:"	#e63333"};
  settings["3"] = {name:"In Progress", color:"#f6cd46"};
  settings["4"] = {name:"Reopened", color:"#e63333"};
  settings["5"] = {name:"Resolved", color:"#00662c"};
  settings["6"] = {name:"Closed", color:"#00ff00"};
  settings["10001"] = {name:"Waiting on Client", color:"#09be9d"};
  settings["10002"] = {name:"Waiting on WSO2", color:"#f67e46"};
  settings["000"] = {name:"Looking forward", color:"#ffffff"};

  return settings[stateID];
}

function getDurationLabel(duration){

  var label = "";
  var durationInHours = Math.floor(duration / 36e5);

  if(durationInHours >= 24){
    var durationInDays = Math.floor(durationInHours / 24);
    var remainderInHours = durationInHours % 24;
    label = label + durationInDays + " days";

    if(remainderInHours > 0){
      label = label + " and " + remainderInHours + " hours";
    }
  }else if(durationInHours > 0){
    label = label + durationInHours + " hours";
  }else{
    label = label + "less than one hour";
  }
  return label;
}

function sum(total, num) {
  return total + num;
}

function isWorkloadSlot(previousSlot, slot, nextSlot){

  var isWorkloadSlot = false;

  // Open or Reopened slots are considered as incoming load.
  if(["1", "4"].includes(slot.status)){
    isWorkloadSlot = true;
  }else if((nextSlot
        && slot.status === "10002"
        && nextSlot.status === "3") ||
      (nextSlot
            && slot.status === "10001"
            && nextSlot.status === "3") ||
      (!nextSlot
      && slot.status === "10002") ||
      (!previousSlot
      && slot.status === "3")
    ){
    // WOW -> In-Progress OR WOC -> In-Progress OR Starting with In-Progress or Ending with WOW
    // as considered as incoming load.
    isWorkloadSlot = true;
  }

  return isWorkloadSlot;
}
