"use strict";
var fs = require('fs');

var sortedWeights = [ "3PFGP", "AP", "ASM", "AT", "DR", "EFGP", "FGP", "FTFGA", "FTP", "OFTFGA", "OPG", "OR", "ORP", "OTP", "OTSP", "P", "PG", "RP", "SS", "Seed", "TM", "TP", "TSP", "WP"];
// Used as a cache so that we aren't re-requesting CSVs over and over
var yearData = {};

var seedMatchOrder = [1, 8, 5, 4, 6, 3, 7, 2];

// map of years to array of regions, each representing hashmaps representing seed numbers
// Does not contain losers of first-four matchups.
var bracketTeamsByRegionAndSeed = {};

// RegionIDs in the csv are the 'regions' indeces
var regions = ['South', 'East', 'West', 'Midwest'];

// Headers that arent used in comparison for winner determination
var nonStatHeaders = ['Rank', 'Region', 'Name', 'Games Won'];

var firstFoursByYear = {};

var latestSeeds = {} // team to seed

var bestScoreYear = '2023'; // track best scores for this year

var mostCorrectWinnersWeights = '';
var mostCorrectWinners = 0;
var mostCorrectWinnersScore = 0;

function main() {
    //let years = ['2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2021', '2022', '2023'];
    let years = ['2023']
    let cache = {} // weightparam to avg score
    
    for (let i = 0; i < years.length; i++) {
        yearData[years[i]] = fs.readFileSync('data/cbbm/' + years[i] + '.csv', {encoding: 'utf-8'});
        parseData(years[i]);
    }
    
    let LineReaderSync = require("line-reader-sync")
    let lrs = new LineReaderSync('weights.total')

    console.log('lrs')
    let maxCount = 0;
    let maxScore = 0;
    let bestScoreWeights = ''
    let bestCountWeights = ''
    let lineCounter = 0;
    let bestPerTeam = {}
    let scoreHistogram = [];
    let countHistogram = [];
    while(true){
        let weightParam = lrs.readline()
        if(weightParam === null){
            break;
        }
        lineCounter++;
        if(weightParam in cache) {
            continue
        }
        let weightData = URLToWeights(weightParam);

        let avgScore = 0
        let avgCount = 0
        let winner = ''
        let winnerCorrectCount = 0;
        for (let i = 0; i < years.length; i++) {
            let year = years[i];
            //console.log(weightParam);
            let scoredata = submit(year, weightData.weights);
            avgCount += scoredata.count;
            avgScore += scoredata.score;
            if (year === bestScoreYear) {
                winner = scoredata.winner;
            }
            if (scoredata.winnerCorrect) {
                winnerCorrectCount += 1;
            }
        }
        if (winnerCorrectCount > mostCorrectWinners) {
            mostCorrectWinners = winnerCorrectCount;
            mostCorrectWinnersWeights = weightParam;
        } else if (winnerCorrectCount == mostCorrectWinners) {
            if (avgScore > mostCorrectWinnersScore) {
                mostCorrectWinnersScore = avgScore;
                mostCorrectWinnersWeights = weightParam;
            }
        }
        
        if(avgScore > maxScore) {
            maxScore = avgScore;
            bestScoreWeights = weightParam;
            console.log('Found new best score', maxScore, bestScoreWeights)
        }
        if(avgCount > maxCount) {
            maxCount = avgCount;
            bestCountWeights = weightParam;
            console.log('Found new best count', maxCount, bestCountWeights)
        }
        if (!(winner in bestPerTeam)) {
            console.log('Found new champion', winner);
            bestPerTeam[winner] = {score: avgScore, scoreWeight: weightParam, count: avgCount, countWeight: weightParam};
        }
        if (avgScore > bestPerTeam[winner].score) {
            bestPerTeam[winner].score = avgScore;
            bestPerTeam[winner].scoreWeight = weightParam;
        } if (avgCount > bestPerTeam[winner].count) {
            bestPerTeam[winner].count = avgCount;
            bestPerTeam[winner].countWeight = weightParam;
        }

        cache[weightParam] = avgScore
        if(lineCounter % 1000 === 0) {
            console.log('Processed ', lineCounter)
        }

        if (scoreHistogram[avgScore] === undefined) {
            scoreHistogram[avgScore] = 1
        } else {
            scoreHistogram[avgScore] += 1
        }
        if (countHistogram[avgCount] === undefined) {
            countHistogram[avgCount] = 1
        } else {
            countHistogram[avgCount] += 1
        }
    }
    let countHistogramOutput = "";
    console.log('count histogram:');
    for (let i = 0; i < countHistogram.length; i++) {
        countHistogramOutput += i.toString() + ',' + (countHistogram[i] || 0) + '\n';
    }
    let scoreHistogramOutput = "";
    console.log('score histogram:');
    for (let i = 0; i < scoreHistogram.length; i++) {
        scoreHistogramOutput += i.toString() + ',' + (scoreHistogram[i] || 0) + '\n';
    }
    
    fs.writeFile("count-histogram-womens.csv", countHistogramOutput, function(err) {
        if(err) {
            return console.log(err);
        }
    }); 
    fs.writeFile("score-histogram-womens.csv", scoreHistogramOutput, function(err) {
        if(err) {
            return console.log(err);
        }
    });
    console.log('found a max score: ', maxScore, bestScoreWeights);
    console.log('found a max count: ', maxCount, bestCountWeights);
    console.log('found most correct winners: ', mostCorrectWinners, mostCorrectWinnersScore, mostCorrectWinnersWeights)
    console.log(bestPerTeam);
    console.log('seed,team,maxScore,maxScoreWeights,maxPicks,maxPicksWeights');
    for(let team in bestPerTeam) {
        if (bestPerTeam.hasOwnProperty(team)) {
            let stats = bestPerTeam[team];
            console.log(latestSeeds[team] + ',' + team + ',' + stats.score + ',http://algebracket.com?w=' + stats.scoreWeight + ',' + stats.count + ',http://algebracket.com?w=' + stats.countWeight);
        }
    }
}
main();



function parseData(year) {
    let lines = yearData[year].trim().split(/\r?\n/), result = [];
    let headers = lines[0].trim().split(',');
    bracketTeamsByRegionAndSeed[year] = [{}, {}, {}, {}];
    firstFoursByYear[year] = [];

    for (let i = 1; i < lines.length; i++) {
        let currentLine = lines[i].split(',');
        let team = {};
        team.stats = {};
        for (let j = 0; j < headers.length; j++) {
            if (nonStatHeaders.indexOf(headers[j]) > -1) {
                team[headers[j]] = currentLine[j];
            } else {
                team.stats[attrToID(headers[j])] = currentLine[j];
            }
        }
        team.Name = abbreviateName(team.Name);
        if (team.stats.Seed in bracketTeamsByRegionAndSeed[year][team.Region]) {
            firstFoursByYear[year].push([team, bracketTeamsByRegionAndSeed[year][team.Region][team.stats.Seed]]);
            delete bracketTeamsByRegionAndSeed[year][team.Region][team.stats.Seed];
        } else {
            bracketTeamsByRegionAndSeed[year][team.Region][team.stats.Seed] = team;
        }
        if(year === bestScoreYear) {
            latestSeeds[team.Name] = team.stats.Seed;
        }   
    }
}

function runMatchup(team1, team2, weights) {
    let team1Total = 0;
    let team2Total = 0;
    for (let weightName in weights) {
        let weight = weights[weightName];
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
    if ((team1Total == team2Total && parseInt(team1.Rank) < parseInt(team2.Rank)) || team1Total > team2Total) {
        return team1;
    } else {
        return team2;
    }
}

function getRound(gameNumber) {
    if (gameNumber >= 1 && gameNumber <= 8) return 1;
    if (gameNumber >= 9 && gameNumber <= 12) return 2;
    if (gameNumber >= 13 && gameNumber <= 14) return 3;
    if (gameNumber == 15) return 4;
    return null;
}

function attrToID(attr) {
    // TODO: might be able to remove this check? maybe leave just seed
    if (nonStatHeaders.indexOf(attr) > -1 || attr == 'Seed') return attr;
    let short = attr.replace(/%/, 'P').replace(/[ a-z%\.\/]/g, '');
    return short
}

function submit(year, weights) {
    let relativeWeights = {};
    for (let i=0; i < weights.length; i++) {
        let param = weights[i];
        relativeWeights[param] = (weights[param] / totalWeight).toFixed(3);
    };
    for (let matchupID in firstFoursByYear[year]) {
        let winner = runMatchup(firstFoursByYear[year][matchupID][0], firstFoursByYear[year][matchupID][1], weights);
        bracketTeamsByRegionAndSeed[year][winner.Region][winner.stats.Seed] = winner;
    }

    
    let correctScore = 0;
    let correctCount = 0;
    let gameWinnerRegions = [{}, {}, {}, {}];

    for (let regionID in regions) {

        let currentRegion = bracketTeamsByRegionAndSeed[year][regionID];
        let gameWinners = gameWinnerRegions[regionID];

        // First round of 64
        for (let index in seedMatchOrder) {
            let seed = seedMatchOrder[index];
            let high = currentRegion[seed];
            let low = currentRegion[17 - seed];
            // game numbers #ids are 1-indexed rather than 0-indexed
            let gameNum = parseInt(index) + 1;
            
            let winner = runMatchup(high, low, weights);
            gameWinners['game' + String(gameNum)] = winner;
            if (winner == undefined) {
                console.log(winner);
            }
            if (winner['Games Won'] > 0) {
                correctScore += 1;
                correctCount++;
            }
        }
        // Round of 32 through the Elite 8
        let gameDiff = 8;
        for (let game = 9; game < 16; game++) {
            let high = gameWinners['game' + String(game - gameDiff)];
            let low = gameWinners['game' + String(game + 1 - gameDiff)];
            
            let winner = runMatchup(high, low, weights);
            gameWinners['game' + String(game)] = winner;

            let round = getRound(game);
            if (winner['Games Won'] >= round) {
                if (game <= 12) correctScore += 2;
                else if (game <= 14) correctScore += 4;
                else correctScore += 8;
                correctCount++;
            }
            gameDiff--;
        }
    }

    let winnerCorrect = false;
    //if (!umbcWon && year === '2018') {
    //    return {count: 0, score: 0, winner: '', umbc: false};
    //}
    // Final four and championship game
    let regionID = 0;
    let sides = ['left', 'right'];
    let championship = {};
    for (let side in sides) {
        let region1 = regionID;
        let region2 = regionID + 1;
        let team1 = gameWinnerRegions[region1].game15;
        let team2 = gameWinnerRegions[region2].game15;
        if ( team1 === undefined ){
            console.log(gameWinnerRegions);
        //    return {count: 0, score: 0, winner: ''};
 
        }
        let winner = runMatchup(team1, team2, weights);
        championship[sides[side]] = winner;
        
        if (winner['Games Won'] >= 5) {
            correctScore += 16;
            correctCount++;
        }
        regionID += 2;
    }
    let winner = runMatchup(championship.left, championship.right, weights);
    if (winner['Games Won'] == 6) {
        correctScore += 32;
        correctCount++;
        winnerCorrect = true;
    }
    
    return {count: correctCount, score: correctScore, winner: winner.Name, winnerCorrect: winnerCorrect};
}

function abbreviateName(name) {
    return name.replace('South ', 'S. ').replace('North ', 'N. ').replace('West ', 'W. ')
    .replace(/\.$/, '').replace('Southern California', 'S. California').replace('Southern', 'Sthn.').replace('Bakersfield', 'Bkfd.');
}

function URLToWeights(urlValue) {
    let weights = {};
    let year = '201' + urlValue[0];
    for(let i=1; i < urlValue.length; i++) {
        let weightVal = urlValue[i];
        if (weightVal === 'A') {
            weightVal = 10;
        } else {
            weightVal = parseInt(weightVal);
        }
        let weightName = sortedWeights[i - 1];
        weights[weightName] = weightVal;
    }
    return {weights: weights, year: year};
}
