/*jslint browser: true*/
/*global $, jQuery, alert*/
var currentWeights = {};

// Used as a cache so that we aren't re-requesting CSVs over and over
var yearData = {};

var seedMatchOrder = [1, 8, 5, 4, 6, 3, 7, 2];

// array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
var bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];

var headers = [];
// RegionIDs in the csv are the 'regions' indeces
var regions = ['South', 'East', 'West', 'Midwest'];

// Headers that arent used in comparison for winner determination
var nonStatHeaders = ['Region', 'Name', 'Rank', 'Games Won'];

var firstFours = [];
var totalGames = 0; // This will be 63 except for the current year
var totalScore = 0; // This will be 192 except for the current year

var urlWeightString = '';
var curYear = '2015';

$(function() {
    var urlParams = {};
    // Grab values from the url if any
    location.search.substr(1).split('&').forEach(function(item) {
        var key = item.split('=')[0];
        urlParams[key] = decodeURIComponent(item.split('=')[1]).replace(/\//g, '');
    });

    if('w' in urlParams) {
        urlWeightString = urlParams.w;
    }
    curYear = getDefaultYear(urlWeightString);
    $('select[name="year"]').val(curYear);
    selectYear();
});

function selectYear() {
    curYear = $('select[name="year"]').val()
    
    if(curYear == '2015') {
        $('#alert').text('Look at previous years to see how your weights perform historically.');
    } else {
        $('#alert').text('');
    }
    
    var currCookie = $.cookie('w');
    if(currCookie !== undefined) {
        $.cookie('w', curYear.substring(3,4) + currCookie.substring(1, currCookie.length));
    }
    
    if(typeof yearData[curYear] === "undefined") {
        $.get(curYear + '-data.csv', function(data) {
            yearData[curYear] = data;
            parseData(curYear);
        });
    } else {
        parseData(curYear);
    }
}


function parseData(year) {
    var lines = yearData[year].trim().split("\n");
    var result = [];
    headers = lines[0].trim().split(',');
    bracketTeamsByRegionAndSeed = [{}, {}, {}, {}];
    firstFours = [];
    totalGames = 0;
    totalScore = 0;
    
    for (var i = 1; i < lines.length; i++) {
        var currentLine = lines[i].split(',');
        var team = {};
        team.stats = {};
        for (var j = 0; j < headers.length; j++) {
            if(nonStatHeaders.indexOf(headers[j]) > -1) {
                team[headers[j]] = currentLine[j];
            } else {
                team.stats[attrToID(headers[j])] = currentLine[j];
            }
        }
        team.stats.R = Math.random();
        if (team.stats.Seed in bracketTeamsByRegionAndSeed[team.Region]) {
            firstFours.push([team, bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed]]);
            delete bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed];
        } else {
            bracketTeamsByRegionAndSeed[team.Region][team.stats.Seed] = team;
        }
        var gamesWon = parseInt(team['Games Won']);
        if(gamesWon > 0) {
            totalGames += gamesWon;
            totalScore += Math.pow(2, gamesWon) - 1;
        }
    }
    

    headers.push('Random');
    var headerCount = headers.length - nonStatHeaders.length;
    var sliderCounter = 0;
    $.each(headers, function(i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        currentWeights[id] = 0;
        if($('#' + id).length === 0) {
            var column = Math.floor(sliderCounter * 3/ headerCount);
            $('#slider-col' + String(column) + ' > ul').append('<li><label class="slider-label" for="' + id + '">' + param + '</label><div class="slider-wrapper"><div class="value" id="' + id + '-val">0</div><div id="' + id + '"></div></div></li>');

            $('#' + id).slider({
                value: 0,
                range: 'min',
                animate: true,
                step: 10,
                slide: function(event, ui) {
                    currentWeights[$(this).attr('id')] = ui.value;
                    $('#' + id + '-val').text(ui.value);
                    submit();
                }
            });
        }
        sliderCounter++;
    });
    if($('#donate').length === 0) {
        $('#slider-col2 > ul').append('<li><label class="slider-label donate" for="donate">Give Beer $$$</label><div class="slider-wrapper"><div class="value" id="donate-val">$0</div><div id="donate"></div></div></li>');
        $('#donate').slider({
            value: 0,
            min: 0,
            max: 10,
            range: 'min',
            animate: true,
            step: 1,
            slide: function(event, ui) {
                $('#donate-val').text('$' + ui.value);
            }
        });
        $('#donate').on('slidechange', function(event, ui) {
            if(ui.value === 0 || isNaN(ui.value)) {
                return;
            }
            //$('.venmo-pay-button').attr('data-amount', ui.value + '.00');
            var venmoUrl = $('#payment-popup > iframe').attr('src');
            $('#payment-popup > iframe').get(0).src = venmoUrl.replace("amount=10.00", "amount=" + ui.value + ".00");
            if(ui.value === 1) {
                $('[name="os0"]').val('1 Dollar'); 
            } else {
                $('[name="os0"]').val(String(ui.value) + ' Dollars'); 
            }
            $("#payment-popup").dialog( "open" );
                
        });
        
        $("#payment-popup").dialog({
            title: "Give Beer Money!",
          autoOpen: false,
          width:230,
          show: {
            effect: "fade",
            duration: 500
          },
          hide: {
            effect: "fade",
            duration: 500
          }
        });
    }
    URLToWeights(urlWeightString);
    
    weightsToURL();
    // Now that sliders have been built and values assigned,
    // setup the event handlers
    $.each(headers, function(i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        $('#' + id).on("slidechange", function(event, ui) {
            var path = weightsToURL();
            //window.history.pushState({id:ui.value},"AlgeBracket", path);
            ga('send', 'event', 'slider-adjust', param, '', ui.value);
        });

    });
    
    setupInitialMatches();
    submit();
}
/*
 * Sets up the initial matchups based on seeding for a given region.
 * Any teams with identical seed numbers and regions are treated as a "First Four" match.
 */

function setupInitialMatches() {
    $('#play-in').text('');
    if(firstFours.length == 1) {
        $('#play-in-title').text('Play-In');
    } else {
        $('#play-in-title').text('First Four');
    }
    for (var matchupID in firstFours) {
        matchup = firstFours[matchupID];
        $('#play-in').append('<li id="matchup' + matchupID + '"><div class="region"> (' + matchup[0].stats.Seed +
        '):</div><div class="team1">' + matchup[0].Name + '</div> vs <div class="team2">' + matchup[1].Name + '</div></li>');
    }
    for (var regionID = 0; regionID < regions.length; regionID++) {
        var region = regions[regionID];
        var list = $('<ul/>');
        regionTeams = bracketTeamsByRegionAndSeed[regionID];
        for (var seed = 1; seed < 9; seed++) {
            var high = regionTeams[seed];
            var lowString = '';
            if ((17 - seed) in regionTeams) {
                var lowTeam = regionTeams[17 - seed];
                lowString = lowTeam.stats.Seed + '. ' + lowTeam.Name;
                $('#' + region.toLowerCase() + 'seed' + lowTeam.stats.Seed).text(lowTeam.stats.Seed + '. ' + lowTeam.Name);
            } else {
                $('#' + region.toLowerCase() + 'seed' + (17 - seed)).html((17 - seed) + '. <i>Play-In winner</i>');
            }
            $('#' + region.toLowerCase() + 'seed' + high.stats.Seed).text(high.stats.Seed + '. ' + high.Name);
        }
    }
    $('#correct').text('0 / ' + totalGames);
    $('#score').text('0 / ' + totalScore);
}

/*
 * Determine the winner of a matchup based on weight.
 * Return the team object for the winning team.
 * Tie breaker is the higher overall rank
 */
function runMatchup(team1, team2, round, team1Div, team2Div) {
    team1Total = 0;
    team2Total = 0;
    for (var weightName in currentWeights) {
        weight = currentWeights[weightName];
        if (team1.stats[weightName] === undefined) {
            console.log('warning: missing stat for ' + team1.Name + ': ' + weightName);
            continue;
        }
        if (weightName == 'Seed') {
            // Higher seeds are worse, so invert the value range
            team1Total += (16 - team1.stats[weightName]) * weight / 16;
            team2Total += (16 - team2.stats[weightName]) * weight / 16;
        } else {
            team1Total += team1.stats[weightName] * weight;
            team2Total += team2.stats[weightName] * weight;
        }
    }
    
    if((team1Total == team2Total && parseInt(team1.Rank) < parseInt(team2.Rank)) || team1Total > team2Total) {
        $(team1Div).removeClass('loser').addClass('winner');
        $(team2Div).removeClass('winner').addClass('loser');
        //console.log(team1.Name + ' won: ' + String(team1Total) + ' > ' + String(team2Total));
        return team1;
    } else {
        $(team2Div).removeClass('loser').addClass('winner');
        $(team1Div).removeClass('winner').addClass('loser');
        //console.log(team2.Name + ' won: ' + String(team2Total) + ' > ' + String(team1Total));

        return team2;
    }
}

/* 
 * Utility function for converting game numbers in gameWinners object to rounds.
 */
function getRound(gameNumber) {
    if(gameNumber >= 1 && gameNumber <= 8) return 1;
    if(gameNumber >= 9 && gameNumber <= 12) return 2;
    if(gameNumber >= 13 && gameNumber <= 14) return 3;
    if(gameNumber == 15) return 4;
    return null;
}
/*
 * Loop through the list of weights, calculating the relative values.
 * Then loop through each matchup, determining the winner and updating the bracket
 */

function submit() {
    var totalWeight = 0;
    $.each(headers, function(i, param) {
        var id = attrToID(param);
        if (nonStatHeaders.indexOf(id) > -1) return true;
        totalWeight += currentWeights[id];
    });
    if(totalWeight === 0) {
        clear();
        return;
    }

    relativeWeights = {};
    $.each(currentWeights, function(param) {
        var id = attrToID(param);
        relativeWeights[param] = (currentWeights[param] / totalWeight).toFixed(3);
    });

    for (var matchupID in firstFours) {
        var team1Div = '#matchup' + matchupID + ' > .team1';
        var team2Div = '#matchup' + matchupID + ' > .team2';
        var winner = runMatchup(firstFours[matchupID][0], firstFours[matchupID][1], -1, team1Div, team2Div);

        bracketTeamsByRegionAndSeed[winner.Region][winner.stats.Seed] = winner;
        $('#' + regions[winner.Region].toLowerCase() + 'seed' + winner.stats.Seed).text(winner.stats.Seed + '. ' + winner.Name);
    }
    
    var correctCount = 0;
    var correctScore = 0;
    var gameWinnerRegions = [{}, {}, {}, {}];
    for (var regionID in regions) {
    //{var regionID = 0; 
        var currentRegion = bracketTeamsByRegionAndSeed[regionID];
        var gameWinners = gameWinnerRegions[regionID];
        var bracketData = {
            teams: [],
            scores: []
        };
        var region = regions[regionID].toLowerCase();
        // First round of 64
        for (var index in seedMatchOrder) {
            var seed = seedMatchOrder[index];
            var high = currentRegion[seed];
            var low = currentRegion[17 - seed];
            // game numbers #ids are 1-indexed rather than 0-indexed
            var gameNum = parseInt(index) + 1;
            var highDiv = '#' + region + 'seed' + high.stats.Seed;
            var lowDiv = '#' + region + 'seed' + low.stats.Seed;
            
            bracketData.teams.push([high.stats.Seed + '. ' + high.Name, low.stats.Seed + '. ' + low.Name]);
            var winner = runMatchup(high, low, 0, highDiv, lowDiv);
            gameWinners['game' + String(gameNum)] = winner;

            $('#' + region + 'seed' + winner.stats.Seed).removeClass('loser').addClass('winner');

            $('#' + region + 'game' + gameNum).text(winner.stats.Seed + '. ' + winner.Name);
            if(totalGames > 0) {
                if(winner['Games Won'] > 0) {
                    correctCount++;
                    correctScore += 1;
                    $('#' + region + 'game' + gameNum).removeClass('incorrect').addClass('correct');
                } else {
                    $('#' + region + 'game' + gameNum).removeClass('correct').addClass('incorrect');
                }
            } else {
                $('#' + region + 'game' + gameNum).removeClass('incorrect').removeClass('correct');
            }
        }
        // Round of 32 through the Elite 8
        var gameDiff = 8;
        for (var game = 9; game < 16; game++) {
            var high = gameWinners['game' + String(game - gameDiff)];
            var low = gameWinners['game' + String(game + 1 - gameDiff)];
            var highDiv = '#' + region + 'game' + String(game - gameDiff);
            var lowDiv = '#' + region + 'game' + String(game + 1- gameDiff);
            var winner = runMatchup(high, low, getRound(game), highDiv, lowDiv);
            
            gameWinners['game' + String(game)] = winner;
            $('#' + region + 'game' + game).text(winner.stats.Seed + '. ' + winner.Name);
            if(totalGames > 0) {
                if(winner['Games Won'] >= getRound(game)) {
                    correctCount++;
                    if(game <= 12) correctScore += 2;
                    else if(game <= 14) correctScore += 4;
                    else correctScore += 8;
                    $('#' + region + 'game' + game).removeClass('incorrect').addClass('correct');
                } else {
                    $('#' + region + 'game' + game).removeClass('correct').addClass('incorrect');
                }
            } else {
                $('#' + region + 'game' + game).removeClass('correct').removeClass('incorrect');
            }
            gameDiff--;
        }
    }
    // Final four and championship game
    var regionID = 0;
    var sides = ['left', 'right'];
    var championship = {};
    for (var side in sides) {
        var region1 = regionID;
        var region2 = regionID + 1;
        var team1 = gameWinnerRegions[region1].game15;
        var team1Div = '#' + regions[region1].toLowerCase() + 'game15';
        var team2Div = '#' + regions[region2].toLowerCase() + 'game15';
        var team2 = gameWinnerRegions[region2].game15;
        var winner = runMatchup(team1, team2, 5, team1Div, team2Div);
        championship[sides[side]] = winner;
        
        $('#' + sides[side] + 'game').text(winner.stats.Seed + '. ' + winner.Name);
        
        if(totalGames > 0) {
            if(winner['Games Won'] >= 5) {
                correctCount++;
                correctScore += 16;
                $('#' + sides[side] + 'game').removeClass('incorrect').addClass('correct');
            } else {
                $('#' + sides[side] + 'game').removeClass('correct').addClass('incorrect');
            }
        } else {
            $('#' + sides[side] + 'game').removeClass('correct').removeClass('incorrect');
        }
        regionID += 2;
    }
    var winner = runMatchup(championship.left, championship.right, 6, '#leftgame', '#rightgame');
    if(totalGames > 0) {
        if(winner['Games Won'] == 6) {
            correctCount++;
            correctScore += 32;
            $('#championship').removeClass('incorrect').addClass('correct');
        } else {
            $('#championship').removeClass('correct').addClass('incorrect');
        }
    } else {
        $('#championship').removeClass('correct').removeClass('incorrect');
    }
    $('#championship').text(winner.stats.Seed + '. ' + winner.Name);
    $('#correct').text(String(correctCount) + ' / ' + String(totalGames));
    $('#score').text(String(correctScore) + ' / ' + String(totalScore));
}

function clear() {
    // Easier to just wipe everything and rerun the setup
    for(var regionID in regions) {
        var regionName = regions[regionID].toLowerCase();
        $('[id^=' + regionName + 'game]').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
        $('[id^=' + regionName + 'seed]').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect');
    }
    $('#play-in').text('');
    $('#leftgame').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
    $('#rightgame').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');
    $('#championship').removeClass('winner').removeClass('loser').removeClass('correct').removeClass('incorrect').text('');

    setupInitialMatches();
}

/*
 * Resets all sliders to zero, clearing the bracket.
 */
function resetSliders() {
    $.each(headers, function(i, param) {
        if (param in nonStatHeaders) return true;
        $('#' + attrToID(param)).slider('value', 0);
        $('#' + attrToID(param) + '-val').text('0');
    });
    $.each(currentWeights, function(i, param) {
       currentWeights[i] = 0;
    });
    //window.history.pushState({},"AlgeBracket", document.URL.split('?')[0]);
    $.removeCookie('w');
    clear();
}

/*
 * Converts the statistic name to the id used in js objects and html ids.
 */

function attrToID(attr) {
    // TODO: might be able to remove this check? maybe leaver just seed
    if (nonStatHeaders.indexOf(attr) > -1 || attr == 'Seed') return attr;
    return attr.replace(/[ a-z%\.\/]/g, '');
}

function weightsToURL() {

    // Create the URL
    var weightValue = saveCookie();
    var path = document.URL.split('?')[0] + '?w=' + weightValue;
    if (path.substring(0, 4) != "http") {
        path = 'http://' + path;
    } 
    
    $('#share').val(path);
    $('#twitter').html('<a class="twitter-share-button" data-text="Check out my #Algebracket!" data-url="' + path + '">Tweet</a>')
    if(twttr !== undefined && twttr.widgets !== undefined) {
        twttr.widgets.load();
    }
    //$('.fb-share-button').attr('data-href', path);
    //window.history.pushState({w:weightValue},"AlgeBracket", path);
    return path;
}

function saveCookie() {
    var sortedWeights = [];
    var urlValue = curYear.substring(3,4);
    for (var k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    for(var weightName in sortedWeights) {
        var weightVal = String(currentWeights[sortedWeights[weightName]] / 10);
        if(weightVal === '10') {
            weightVal = 'A';
        }
        urlValue += weightVal;
    }
    $.cookie('w', urlValue);
    return urlValue
}

function URLToWeights(urlValue) {
    var weights = {};
    var sortedWeights = [];
    for (var k in currentWeights) {
        sortedWeights.push(k);
    }
    sortedWeights.sort();
    if(urlValue.length == 0 && $.cookie('w') !== undefined) {
        urlValue = $.cookie('w');
    }
    year = '201' + urlValue[0];
    
    for(var i=1; i < urlValue.length - 1; i++) {
        var weightVal = urlValue[i];
        if(weightVal === 'A') {
            weightVal = 100;
        } else {
            weightVal = parseInt(weightVal) * 10;
        }
        weightName = sortedWeights[i - 1];
        $('#' + weightName).slider('value', weightVal);
        currentWeights[weightName] = weightVal;
        $('#' + weightName + '-val').text(weightVal);
    }
}

function getDefaultYear(urlValue) {
    var defYear = curYear;
    if(urlValue !== '') {
        defYear = '201' + urlValue[0];
    } else if($.cookie('w') !== undefined && !isNaN(parseInt($.cookie('w').substring(0,1)))) {

        defYear = '201' + $.cookie('w').substring(0,1);
    }
    return defYear
}