"use strict";
var fs = require('fs');
var os = require('os');
var path = require('path');
var { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

var sortedWeights = [ "3PFGP", "AP", "ASM", "AT", "DR", "EFGP", "FGP", "FTFGA", "FTP", "OFTFGA", "OPG", "OR", "ORP", "OTP", "OTSP", "P", "PG", "RP", "SS", "Seed", "TM", "TP", "TSP", "WP"];
var seedMatchOrder = [1, 8, 5, 4, 6, 3, 7, 2];
var regions = ['South', 'East', 'West', 'Midwest'];
var nonStatHeaders = ['Rank', 'Region', 'Name', 'Games Won'];

var bestScoreYear = '2025';

function getRecencyWeight(year, latestYear) {
    let yearsAgo = latestYear - parseInt(year);
    return Math.pow(0.5, yearsAgo / 3);
}

// ============================================================
// WORKER CODE
// ============================================================
if (!isMainThread) {
    let { years, recencyWeights, weightLines, yearDataMap } = workerData;

    // Each worker parses its own copy of the data
    let yearData = yearDataMap;
    let bracketTeamsByRegionAndSeed = {};
    let firstFoursByYear = {};

    for (let i = 0; i < years.length; i++) {
        parseData(years[i]);
    }

    // Process assigned weight lines
    let maxScore = 0, bestScoreWeights = '', bestScoreMargins = null;
    let maxCount = 0, bestCountWeights = '';
    let maxRecencyScore = 0, bestRecencyScoreWeights = '';
    let mostCorrectWinners = 0, mostCorrectWinnersScore = 0, mostCorrectWinnersWeights = '';
    let bestPerTeam = {};
    let scoreHistogram = [];
    let countHistogram = [];
    let recencyScoreHistogram = [];
    let weightsByScore = [];
    let processed = 0;

    for (let idx = 0; idx < weightLines.length; idx++) {
        let weightParam = weightLines[idx];
        let weightData = URLToWeights(weightParam);

        let avgScore = 0, avgCount = 0, recencyScore = 0;
        let winner = '';
        let winnerCorrectCount = 0;
        let allMargins = [];

        for (let i = 0; i < years.length; i++) {
            let year = years[i];
            let scoredata = submit(year, weightData.weights);
            avgCount += scoredata.count;
            avgScore += scoredata.score;
            recencyScore += scoredata.score * recencyWeights[year];
            allMargins = allMargins.concat(scoredata.matchupMargins);
            if (year === bestScoreYear) {
                winner = scoredata.winner;
                if (!weightsByScore[avgScore]) weightsByScore[avgScore] = [];
                weightsByScore[avgScore].push(weightParam);
            }
            if (scoredata.winnerCorrect) {
                winnerCorrectCount += 1;
            }
        }

        if (winnerCorrectCount > mostCorrectWinners) {
            mostCorrectWinners = winnerCorrectCount;
            mostCorrectWinnersWeights = weightParam;
            mostCorrectWinnersScore = avgScore;
        } else if (winnerCorrectCount == mostCorrectWinners && avgScore > mostCorrectWinnersScore) {
            mostCorrectWinnersScore = avgScore;
            mostCorrectWinnersWeights = weightParam;
        }

        if (recencyScore > maxRecencyScore) {
            maxRecencyScore = recencyScore;
            bestRecencyScoreWeights = weightParam;
        }
        let recencyBucket = Math.round(recencyScore);
        recencyScoreHistogram[recencyBucket] = (recencyScoreHistogram[recencyBucket] || 0) + 1;

        if (avgScore > maxScore) {
            maxScore = avgScore;
            bestScoreWeights = weightParam;
            bestScoreMargins = allMargins;
        }
        if (avgCount > maxCount) {
            maxCount = avgCount;
            bestCountWeights = weightParam;
        }

        if (!(winner in bestPerTeam)) {
            bestPerTeam[winner] = {score: avgScore, scoreWeight: weightParam, count: avgCount, countWeight: weightParam};
        }
        if (avgScore > bestPerTeam[winner].score) {
            bestPerTeam[winner].score = avgScore;
            bestPerTeam[winner].scoreWeight = weightParam;
        }
        if (avgCount > bestPerTeam[winner].count) {
            bestPerTeam[winner].count = avgCount;
            bestPerTeam[winner].countWeight = weightParam;
        }

        scoreHistogram[avgScore] = (scoreHistogram[avgScore] || 0) + 1;
        countHistogram[avgCount] = (countHistogram[avgCount] || 0) + 1;

        processed++;
        if (processed % 10000 === 0) {
            parentPort.postMessage({type: 'progress', count: processed});
        }
    }

    parentPort.postMessage({
        type: 'done',
        result: {
            maxScore, bestScoreWeights, bestScoreMargins,
            maxCount, bestCountWeights,
            maxRecencyScore, bestRecencyScoreWeights,
            mostCorrectWinners, mostCorrectWinnersScore, mostCorrectWinnersWeights,
            bestPerTeam,
            scoreHistogram,
            countHistogram,
            recencyScoreHistogram,
            weightsByScore,
            processed
        }
    });

    // Worker-local functions that need worker-local state
    function parseData(year) {
        let lines = yearData[year].trim().split(/\r?\n/);
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
        }
    }

    function submit(year, weights) {
        // Deep copy bracket data since submit mutates it for first-four results
        let localBracket = [{}, {}, {}, {}];
        for (let r = 0; r < 4; r++) {
            for (let seed in bracketTeamsByRegionAndSeed[year][r]) {
                localBracket[r][seed] = bracketTeamsByRegionAndSeed[year][r][seed];
            }
        }

        for (let matchupID in firstFoursByYear[year]) {
            let result = runMatchup(firstFoursByYear[year][matchupID][0], firstFoursByYear[year][matchupID][1], weights);
            localBracket[result.winner.Region][result.winner.stats.Seed] = result.winner;
        }

        let correctScore = 0;
        let correctCount = 0;
        let gameWinnerRegions = [{}, {}, {}, {}];
        let matchupMargins = [];

        for (let regionID in regions) {
            let currentRegion = localBracket[regionID];
            let gameWinners = gameWinnerRegions[regionID];

            for (let index in seedMatchOrder) {
                let seed = seedMatchOrder[index];
                let high = currentRegion[seed];
                let low = currentRegion[17 - seed];
                let gameNum = parseInt(index) + 1;

                let result = runMatchup(high, low, weights);
                gameWinners['game' + String(gameNum)] = result.winner;
                let correct = result.winner['Games Won'] > 0;
                if (correct) {
                    correctScore += 1;
                    correctCount++;
                }
                matchupMargins.push({certainty: result.certainty, margin: result.margin, correct: correct, round: 1});
            }
            let gameDiff = 8;
            for (let game = 9; game < 16; game++) {
                let high = gameWinners['game' + String(game - gameDiff)];
                let low = gameWinners['game' + String(game + 1 - gameDiff)];

                let result = runMatchup(high, low, weights);
                gameWinners['game' + String(game)] = result.winner;

                let round = getRound(game);
                let correct = result.winner['Games Won'] >= round;
                if (correct) {
                    if (game <= 12) correctScore += 2;
                    else if (game <= 14) correctScore += 4;
                    else correctScore += 8;
                    correctCount++;
                }
                matchupMargins.push({certainty: result.certainty, margin: result.margin, correct: correct, round: round});
                gameDiff--;
            }
        }

        let winnerCorrect = false;
        let regionID = 0;
        let sides = ['left', 'right'];
        let championship = {};
        for (let side in sides) {
            let region1 = regionID;
            let region2 = regionID + 1;
            let team1 = gameWinnerRegions[region1].game15;
            let team2 = gameWinnerRegions[region2].game15;
            let result = runMatchup(team1, team2, weights);
            championship[sides[side]] = result.winner;

            let correct = result.winner['Games Won'] >= 5;
            if (correct) {
                correctScore += 16;
                correctCount++;
            }
            matchupMargins.push({certainty: result.certainty, margin: result.margin, correct: correct, round: 5});
            regionID += 2;
        }
        let result = runMatchup(championship.left, championship.right, weights);
        if (result.winner['Games Won'] == 6) {
            correctScore += 32;
            correctCount++;
            winnerCorrect = true;
        }
        matchupMargins.push({certainty: result.certainty, margin: result.margin, correct: result.winner['Games Won'] == 6, round: 6});

        return {count: correctCount, score: correctScore, winner: result.winner.Name, winnerCorrect: winnerCorrect, matchupMargins: matchupMargins};
    }
}

// ============================================================
// MAIN THREAD CODE
// ============================================================
if (isMainThread) {
    main();
}

function main() {
    let years = ['2025'];
    //let years = ['2022', '2023', '2024', '2025'];
    let numCPUs = os.cpus().length;
    console.log('Using', numCPUs, 'worker threads');

    // Load CSV data to pass to workers
    let yearDataMap = {};
    let latestSeeds = {};
    for (let i = 0; i < years.length; i++) {
        yearDataMap[years[i]] = fs.readFileSync('data/cbbm/' + years[i] + '.csv', {encoding: 'utf-8'});
    }

    // Parse latestSeeds in main thread for final output
    {
        let lines = yearDataMap[bestScoreYear].trim().split(/\r?\n/);
        let headers = lines[0].trim().split(',');
        for (let i = 1; i < lines.length; i++) {
            let currentLine = lines[i].split(',');
            let name = '', seed = '';
            for (let j = 0; j < headers.length; j++) {
                if (headers[j] === 'Name') name = abbreviateName(currentLine[j]);
                if (headers[j] === 'Seed') seed = currentLine[j];
            }
            latestSeeds[name] = seed;
        }
    }

    let latestYear = Math.max(...years.map(Number));
    let recencyWeights = {};
    for (let i = 0; i < years.length; i++) {
        recencyWeights[years[i]] = getRecencyWeight(years[i], latestYear);
    }
    console.log('Recency weights:', recencyWeights);

    // Read all weight lines and deduplicate
    console.log('Reading weight lines...');
    let LineReaderSync = require("line-reader-sync");
    let lrs = new LineReaderSync('weights.total');
    let allLines = [];
    let seen = new Set();
    while (true) {
        let line = lrs.readline();
        if (line === null) break;
        if (line.length !== 25 || seen.has(line)) continue;
        seen.add(line);
        allLines.push(line);
    }
    console.log('Total unique weight lines:', allLines.length);

    // Split lines into chunks for workers
    let chunkSize = Math.ceil(allLines.length / numCPUs);
    let chunks = [];
    for (let i = 0; i < allLines.length; i += chunkSize) {
        chunks.push(allLines.slice(i, i + chunkSize));
    }

    let completedWorkers = 0;
    let totalProcessed = 0;
    let workerResults = [];

    let startTime = Date.now();

    for (let i = 0; i < chunks.length; i++) {
        let worker = new Worker(__filename, {
            workerData: {
                years: years,
                recencyWeights: recencyWeights,
                weightLines: chunks[i],
                yearDataMap: yearDataMap
            }
        });

        worker.on('message', (msg) => {
            if (msg.type === 'progress') {
                totalProcessed += msg.count;
                // Reset the count tracking - progress is cumulative per report
            } else if (msg.type === 'done') {
                workerResults.push(msg.result);
                completedWorkers++;
                console.log('Worker', completedWorkers, '/', chunks.length, 'done -', msg.result.processed, 'lines processed');

                if (completedWorkers === chunks.length) {
                    let elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log('All workers done in', elapsed, 'seconds');
                    mergeAndReport(workerResults, years, recencyWeights, latestSeeds);
                }
            }
        });

        worker.on('error', (err) => {
            console.error('Worker error:', err);
        });
    }
}

function mergeAndReport(results, years, recencyWeights, latestSeeds) {
    let maxScore = 0, bestScoreWeights = '', bestScoreMargins = null;
    let maxCount = 0, bestCountWeights = '';
    let maxRecencyScore = 0, bestRecencyScoreWeights = '';
    let mostCorrectWinners = 0, mostCorrectWinnersScore = 0, mostCorrectWinnersWeights = '';
    let bestPerTeam = {};
    let scoreHistogram = [];
    let countHistogram = [];
    let recencyScoreHistogram = [];
    let weightsByScore = [];
    let totalProcessed = 0;

    for (let r of results) {
        totalProcessed += r.processed;

        if (r.maxScore > maxScore) {
            maxScore = r.maxScore;
            bestScoreWeights = r.bestScoreWeights;
            bestScoreMargins = r.bestScoreMargins;
        }
        if (r.maxCount > maxCount) {
            maxCount = r.maxCount;
            bestCountWeights = r.bestCountWeights;
        }
        if (r.maxRecencyScore > maxRecencyScore) {
            maxRecencyScore = r.maxRecencyScore;
            bestRecencyScoreWeights = r.bestRecencyScoreWeights;
        }
        if (r.mostCorrectWinners > mostCorrectWinners) {
            mostCorrectWinners = r.mostCorrectWinners;
            mostCorrectWinnersWeights = r.mostCorrectWinnersWeights;
            mostCorrectWinnersScore = r.mostCorrectWinnersScore;
        } else if (r.mostCorrectWinners == mostCorrectWinners && r.mostCorrectWinnersScore > mostCorrectWinnersScore) {
            mostCorrectWinnersScore = r.mostCorrectWinnersScore;
            mostCorrectWinnersWeights = r.mostCorrectWinnersWeights;
        }

        // Merge bestPerTeam
        for (let team in r.bestPerTeam) {
            let s = r.bestPerTeam[team];
            if (!(team in bestPerTeam)) {
                bestPerTeam[team] = {score: s.score, scoreWeight: s.scoreWeight, count: s.count, countWeight: s.countWeight};
            } else {
                if (s.score > bestPerTeam[team].score) {
                    bestPerTeam[team].score = s.score;
                    bestPerTeam[team].scoreWeight = s.scoreWeight;
                }
                if (s.count > bestPerTeam[team].count) {
                    bestPerTeam[team].count = s.count;
                    bestPerTeam[team].countWeight = s.countWeight;
                }
            }
        }

        // Merge histograms
        for (let i = 0; i < r.scoreHistogram.length; i++) {
            if (r.scoreHistogram[i]) scoreHistogram[i] = (scoreHistogram[i] || 0) + r.scoreHistogram[i];
        }
        for (let i = 0; i < r.countHistogram.length; i++) {
            if (r.countHistogram[i]) countHistogram[i] = (countHistogram[i] || 0) + r.countHistogram[i];
        }
        for (let i = 0; i < r.recencyScoreHistogram.length; i++) {
            if (r.recencyScoreHistogram[i]) recencyScoreHistogram[i] = (recencyScoreHistogram[i] || 0) + r.recencyScoreHistogram[i];
        }

        // Merge weightsByScore
        for (let i = 0; i < r.weightsByScore.length; i++) {
            if (r.weightsByScore[i] && r.weightsByScore[i].length > 0) {
                if (!weightsByScore[i]) weightsByScore[i] = [];
                weightsByScore[i] = weightsByScore[i].concat(r.weightsByScore[i]);
            }
        }
    }

    console.log('Total processed:', totalProcessed);

    // Output histograms
    let countHistogramOutput = "";
    for (let i = 0; i < countHistogram.length; i++) {
        countHistogramOutput += i.toString() + ',' + (countHistogram[i] || 0) + '\n';
    }
    let scoreHistogramOutput = "";
    for (let i = 0; i < scoreHistogram.length; i++) {
        scoreHistogramOutput += i.toString() + ',' + (scoreHistogram[i] || 0) + '\n';
    }

    fs.writeFile("count-histogram-womens.csv", countHistogramOutput, function(err) {
        if(err) return console.log(err);
    });
    fs.writeFile("score-histogram-womens.csv", scoreHistogramOutput, function(err) {
        if(err) return console.log(err);
    });

    console.log('found a max score: ', maxScore, bestScoreWeights);
    console.log('found a max count: ', maxCount, bestCountWeights);
    console.log('found most correct winners: ', mostCorrectWinners, mostCorrectWinnersScore, mostCorrectWinnersWeights);
    console.log('seed,team,maxScore,maxScoreWeights,maxPicks,maxPicksWeights');
    for (let team in bestPerTeam) {
        if (bestPerTeam.hasOwnProperty(team)) {
            let stats = bestPerTeam[team];
            console.log(latestSeeds[team] + ',' + team + ',' + stats.score + ',http://algebracket.com?w=' + stats.scoreWeight + ',' + stats.count + ',http://algebracket.com?w=' + stats.countWeight);
        }
    }

    console.log('best weights:');
    let bestWeights = 0;
    let bestWeightIndex = (weightsByScore.length || 1) - 1;
    let weightCounts = Array(sortedWeights.length).fill(BigInt(0));
    const bestThreshold = 1000;
    while (bestWeights < bestThreshold && bestWeightIndex >= 0) {
        if (weightsByScore[bestWeightIndex]) {
            for (let weightP in weightsByScore[bestWeightIndex]) {
                let weight = weightsByScore[bestWeightIndex][weightP];
                for (let i = 1; i < weight.length; i++) {
                    var weightVal = weight[i];
                    if (weightVal !== '0') {
                        if (weightVal === 'A') weightVal = 10;
                        weightCounts[i-1] += BigInt(parseInt(weightVal));
                    }
                }
                bestWeights += 1;
                if (bestWeights > bestThreshold) break;
            }
        }
        bestWeightIndex -= 1;
    }
    for (let i = 0; i < weightCounts.length; i++) {
        console.log(sortedWeights[i],
            Number((weightCounts[i] * BigInt(100) / BigInt(Math.max(bestWeights, 1))))
        );
    }

    // Recency-weighted results
    console.log('\n=== Recency-Weighted Results (half-life=3 years) ===');
    console.log('Recency weights per year:', recencyWeights);
    console.log('Best recency-weighted score:', Math.round(maxRecencyScore * 100) / 100, bestRecencyScoreWeights);
    console.log('  URL: http://algebracket.com?w=' + bestRecencyScoreWeights);
    console.log('Best raw score:', maxScore, bestScoreWeights);
    if (bestRecencyScoreWeights !== bestScoreWeights) {
        console.log('  (recency-weighted best DIFFERS from raw best)');
    }

    let recencyHistogramOutput = "";
    for (let i = 0; i < recencyScoreHistogram.length; i++) {
        recencyHistogramOutput += i.toString() + ',' + (recencyScoreHistogram[i] || 0) + '\n';
    }
    fs.writeFile("score-histogram-recency.csv", recencyHistogramOutput, function(err) {
        if(err) return console.log(err);
    });

    // Matchup-Margin Calibration Analysis
    console.log('\n=== Matchup-Margin Calibration (best-scoring weights) ===');
    if (bestScoreMargins) {
        let calibrationBins = {};
        let roundCalibration = {};
        for (let m of bestScoreMargins) {
            let bucket = Math.min(Math.floor(m.certainty / 10) * 10, 90);
            if (!calibrationBins[bucket]) calibrationBins[bucket] = {correct: 0, total: 0};
            calibrationBins[bucket].total++;
            if (m.correct) calibrationBins[bucket].correct++;

            if (!roundCalibration[m.round]) roundCalibration[m.round] = {correct: 0, total: 0, sumCertainty: 0, correctSumCertainty: 0, wrongSumCertainty: 0};
            roundCalibration[m.round].total++;
            roundCalibration[m.round].sumCertainty += m.certainty;
            if (m.correct) {
                roundCalibration[m.round].correct++;
                roundCalibration[m.round].correctSumCertainty += m.certainty;
            } else {
                roundCalibration[m.round].wrongSumCertainty += m.certainty;
            }
        }

        console.log('\nCalibration by certainty bucket (does higher confidence = more correct?):');
        console.log('Certainty%,Games,Correct,Accuracy%');
        let sortedBuckets = Object.keys(calibrationBins).map(Number).sort((a, b) => a - b);
        for (let bucket of sortedBuckets) {
            let bin = calibrationBins[bucket];
            let accuracy = ((bin.correct / bin.total) * 100).toFixed(1);
            console.log(bucket + '-' + (bucket + 9) + '%,' + bin.total + ',' + bin.correct + ',' + accuracy);
        }

        let roundNames = {1: 'R64', 2: 'R32', 3: 'Sweet 16', 4: 'Elite 8', 5: 'Final Four', 6: 'Championship'};
        console.log('\nAccuracy by round:');
        console.log('Round,Games,Correct,Accuracy%,AvgCertainty,AvgCertaintyCorrect,AvgCertaintyWrong');
        let sortedRounds = Object.keys(roundCalibration).map(Number).sort((a, b) => a - b);
        for (let round of sortedRounds) {
            let r = roundCalibration[round];
            let accuracy = ((r.correct / r.total) * 100).toFixed(1);
            let avgCert = (r.sumCertainty / r.total).toFixed(1);
            let avgCertCorrect = r.correct > 0 ? (r.correctSumCertainty / r.correct).toFixed(1) : 'N/A';
            let avgCertWrong = (r.total - r.correct) > 0 ? (r.wrongSumCertainty / (r.total - r.correct)).toFixed(1) : 'N/A';
            console.log((roundNames[round] || round) + ',' + r.total + ',' + r.correct + ',' + accuracy + ',' + avgCert + ',' + avgCertCorrect + ',' + avgCertWrong);
        }

        let brierSum = 0;
        for (let m of bestScoreMargins) {
            let predictedProb = m.certainty / 100;
            let actual = m.correct ? 1 : 0;
            brierSum += Math.pow(predictedProb - actual, 2);
        }
        let brierScore = (brierSum / bestScoreMargins.length).toFixed(4);
        console.log('\nBrier score (lower=better calibrated):', brierScore);
        console.log('Total matchups analyzed:', bestScoreMargins.length);
    }
}

// ============================================================
// SHARED FUNCTIONS (used by both main and worker)
// ============================================================

function runMatchup(team1, team2, weights) {
    let team1Total = 0;
    let team2Total = 0;
    for (let weightName in weights) {
        let weight = weights[weightName];
        if (team1.stats[weightName] === undefined) {
            continue;
        }
        if (weightName == 'Seed') {
            team1Total += (16 - team1.stats[weightName]) * weight / 16;
            team2Total += (16 - team2.stats[weightName]) * weight / 16;
        } else {
            team1Total += team1.stats[weightName] * weight;
            team2Total += team2.stats[weightName] * weight;
        }
    }
    let winner, loser;
    if ((team1Total == team2Total && parseInt(team1.Rank) < parseInt(team2.Rank)) || team1Total > team2Total) {
        winner = team1;
        loser = team2;
    } else {
        winner = team2;
        loser = team1;
    }
    let winnerTotal = Math.max(team1Total, team2Total);
    let loserTotal = Math.min(team1Total, team2Total);
    let certainty = (winnerTotal + loserTotal) > 0
        ? Math.ceil((2 * (100 * winnerTotal / (winnerTotal + loserTotal))) - 100)
        : 0;
    return { winner: winner, loser: loser, margin: winnerTotal - loserTotal, certainty: certainty };
}

function getRound(gameNumber) {
    if (gameNumber >= 1 && gameNumber <= 8) return 1;
    if (gameNumber >= 9 && gameNumber <= 12) return 2;
    if (gameNumber >= 13 && gameNumber <= 14) return 3;
    if (gameNumber == 15) return 4;
    return null;
}

function attrToID(attr) {
    if (nonStatHeaders.indexOf(attr) > -1 || attr == 'Seed') return attr;
    let short = attr.replace(/%/, 'P').replace(/[ a-z%\.\/]/g, '');
    return short;
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
