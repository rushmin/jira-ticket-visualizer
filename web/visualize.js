var endDateTime;
var visualizationDuration;
var startDateTime;

$("#drawGraph").click(function() {
  clearGraph();
  var tickets = loadTickets(loadTicketCallback);
});

function loadTicketCallback(tickets){

  visualizationDuration = $("#duration").val();

  var durationExpressionElements = visualizationDuration.split(" ");
  startDateTime = moment().subtract(parseInt(durationExpressionElements[0]), durationExpressionElements[1]);
  endDateTime = new Date();

  var graphData = processTickets(tickets);
  drawGraph(graphData);
}


function loadTickets(loadTicketCallback){
  return loadTicketsWithHTTP(loadTicketCallback);
}

function loadTicketsWithHTTP(loadTicketCallback){

  var jql = $("#jql").val();
  var maxResults = $("#maxResults").val();

  $.ajax({
    method: "POST",
    url: properties.serviceURL,
    data: { jql: jql, maxResults: maxResults },
    timeout: properties.serviceCallTimeout
  })
  .done(function( response ) {
    loadTicketCallback.call(this, response)
  });

}

function processTickets(tickets){

  var ticketsWithEvents = buildEvents(tickets);

  console.log(ticketsWithEvents);

  var ticketsWithEvents = trimEvents(ticketsWithEvents, startDateTime);

  console.log(ticketsWithEvents);

  var timeline = buildTimeline(ticketsWithEvents);

  console.log(timeline);

  return new buildGraphData(timeline);
}

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

function buildTimeline(ticketsWithEvents){

  var timeline = new Array();

  for(var i = 0; i < ticketsWithEvents.length; i++){
    var timeslots = new Array();

    if(ticketsWithEvents[i].events.length === 0){
      continue;
    }

    for(var j = 0; j < ticketsWithEvents[i].events.length - 1; j++){
      timeslots.push({status:ticketsWithEvents[i].events[j].to, duration:(new Date(ticketsWithEvents[i].events[j+1].date) - new Date(ticketsWithEvents[i].events[j].date))});
    }

    // Compute the last slot.
    var lastIndex = ticketsWithEvents[i].events.length - 1;
    timeslots.push({status:ticketsWithEvents[i].events[j].to, duration:(endDateTime - new Date(ticketsWithEvents[i].events[lastIndex].date))});
    timeline.push({ticketID:ticketsWithEvents[i].ticketID, timeslots:timeslots});
  }

  return timeline;
}

function buildGraphData(timeline){

  var labels = new Array();
  var datasets = new Array();

  var maxSlots = 0;
  for(var i = 0; i < timeline.length; i++){

    labels.push(timeline[i].ticketID);

    // Find the max number of slots
    if(maxSlots < timeline[i].timeslots.length){
      maxSlots = timeline[i].timeslots.length;
    }
  }

  for(var i = 0; i < maxSlots; i++){
    datasets.push(
              {label:"MyLabel",
               data:[],
               fill:false,
               backgroundColor:[],
               borderWidth:0
             });
  }

  for(var i = 0; i < timeline.length; i++){

    var j;
    for(j = 0; j < timeline[i].timeslots.length; j++){
      datasets[j].data.push(timeline[i].timeslots[j].duration);
      datasets[j].backgroundColor.push(getColorForState(timeline[i].timeslots[j].status));
    }

    // Padding
    if(maxSlots > timeline[i].timeslots.length){
      for(k = 0; k < (maxSlots - timeline[i].timeslots.length); k++){
        datasets[j + k].data.push(0);
        datasets[j + k].backgroundColor.push(getColorForState("000"));
      }
    }
  }
  return {labels:labels, datasets:datasets};
}

function drawGraph(graphData){

  if(graphData.labels.length === 0){
    return;
  }

  var graphHeight = graphData.labels.length * 6;
  var ticketGraphHTMLBlock = '<canvas id="ticketGraph"></canvas>'
  $('#ticketGraphContainer').append($(ticketGraphHTMLBlock));

  $('#ticketGraph').width(400);
  $('#ticketGraph').height(graphHeight);

  var ctx = document.getElementById('ticketGraph').getContext('2d');
  new Chart(ctx,
    { type:"horizontalBar",
      data:{
        labels: graphData.labels,
        datasets: graphData.datasets
      },
      options:{
        scales:{
        xAxes:[{
          stacked: true,
          ticks: {
                    callback: function(value, index, values) {

                        return moment(startDateTime).add(value).format("MMM DD(dd), h:mm a");
                    },
                    maxTicksLimit: 100,
                }
        }],
        yAxes: [{
            stacked: true
        }]

      },
      tooltips: {
            callbacks: {
                label: function(tooltipItem, data) {
                    var duration = tooltipItem.xLabel;
                    return getDurationLabel(duration);
                }
            }
      },
      legend: {
            display: false,
      },
      title: {
            display: true,
            text: 'Tickets (since ' + visualizationDuration + ' ago from '  + moment(endDateTime).format("DD, MMM") + " )"
      },
      onClick:function(evt){

        // TODO : This is a hack.
        if(this.tooltip._model.title){
            var ticketID = this.tooltip._model.title[0];
            var url = "https://support.wso2.com/jira/browse/" + ticketID;
            window.open(url);
        }

      }
    }
    });

}

function clearGraph(){
  var canvas = $('#ticketGraphContainer').empty(); // or document.getElementById('canvas');
}

function getColorForState(stateID){

  var colorMap = new Object();
  colorMap["1"] = "rgba(230, 51, 51, 1)"; // Open
  colorMap["3"] = "rgba(246, 205, 70, 1)"; // In Progress
  colorMap["4"] = "rgba(230, 51, 51, 1)"; // Reopened
  colorMap["5"] = "rgba(0, 102, 44, 1)"; //Resolved
  colorMap["10001"] = "rgba(9, 190, 157, 1)"; //Waiting on Client
  colorMap["10002"] = "rgba(246, 126, 70, 1)"; //Waiting on WSO2
  colorMap["000"] = "rgba(255, 255, 255)"; //Not opened yet

  return colorMap[stateID];
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
