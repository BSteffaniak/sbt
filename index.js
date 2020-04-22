#!/usr/bin/env node

const uuid = require('uuid').v4;
const readlineSync = require('readline-sync');

const storage = require('node-persist');
const fs = require('fs');
const resolve = require('path').resolve;

const {spawnSync} = require('child_process');

const gitFunc = require("simple-git/promise");
const request = require("request");
const Rox = require("rox-node");

const sbtJsonPath = `${process.cwd()}/sbt.json`;

let sbt;

let pivotalProjectId;
let pivotalTrackerToken;
let roxApiKey;
let roxAppKey;
let upsourceProjectName;
let repoUrl;
let repoPath;
let branchName;
let stagingBranchName;
let productionBranchName;

let git;

let numberOfStoriesPrinted = 0;
let pivotalStories;
let previousReleaseDate = null;
let currentReleaseDate = null;

let args;

function sbtJsonExists() {
  return fs.existsSync(sbtJsonPath);
}

function initializeSbtInfo() {
  if (sbtJsonExists()) {
    sbt = JSON.parse(fs.readFileSync(sbtJsonPath, 'utf8'));
  } else {
    sbt = {};
  }

  pivotalProjectId = sbt.pivotal ? sbt.pivotal.projectId : undefined;
  pivotalTrackerToken = sbt.pivotal ? sbt.pivotal.trackerToken : undefined;
  roxApiKey = sbt.rox ? sbt.rox.apiKey : undefined;
  roxAppKey = sbt.rox ? sbt.rox.appKey : undefined;
  upsourceProjectName = sbt.upsourceProjectName;
  repoUrl = sbt.repoUrl;
  repoPath = (args.repoPath || sbt.repoPath || ".").trim()
  branchName = sbt.branchName || "master";
  stagingBranchName = sbt.stagingBranchName || "staging";
  productionBranchName = sbt.productionBranchName || "production";
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCommitMessages() {
  git = gitFunc(repoPath);

  args.skipStoryIds = args.skipStoryIds || [];
  args.skipCommitHashes = args.skipCommitHashes || [];

  const pastReleases = sbt.releases.slice(0, sbt.releases.length - 1);
  const currentRelease = sbt.releases[sbt.releases.length - 1];
  const releaseCommits = await git.log({from: currentRelease.from, to: currentRelease.to});

  const previousReleaseCommitLogs = await Promise.all(
    pastReleases.map(release => git.log({from: release.from, to: release.to}))
  );

  previousReleaseCommitLogs.forEach((log) => {
    log.all = log.all.filter((commit) => {
      const keep = args.skipStoryIds.every(id => commit.message.indexOf(id) === -1) &&
        args.skipCommitHashes.every(hash => commit.hash.indexOf(hash) === -1);

      if (!keep) {
        console.log(`Skipping ${commit.hash} ${commit.message}`);
      }

      return keep;
    });
  });

  const lastRelease = previousReleaseCommitLogs[previousReleaseCommitLogs.length - 1];
  const currentCommit = releaseCommits.all[releaseCommits.total - 1];

  let dedupedCommits = releaseCommits.all.filter((commit) => {
    const keep = args.skipStoryIds.every(id => commit.message.indexOf(id) === -1) &&
      args.skipCommitHashes.every(hash => commit.hash.indexOf(hash) === -1);

    if (!keep) {
      console.log(`Skipping ${commit.hash} ${commit.message}`);
    }

    return keep;
  });

  if (lastRelease && currentCommit) {
    previousReleaseDate = Date.parse(lastRelease.latest.date);
    currentReleaseDate = Date.parse(currentCommit.date);

    const allPreviousReleaseCommits = previousReleaseCommitLogs.flatMap(commits => commits.all);
    const allPreviousReleaseCommitsMap = {};

    allPreviousReleaseCommits.forEach((commit) => {
      allPreviousReleaseCommitsMap[commit.date + commit.message] = true;
    });

    const duplicateCommits = [];

    dedupedCommits = dedupedCommits.filter((commit) => {
      if (allPreviousReleaseCommitsMap[commit.date + commit.message]) {
        duplicateCommits.push(commit);

        return false;
      } else {
        return true;
      }
    });

    if (duplicateCommits.length > 0 && args.dupes !== false) {
      console.warn("Removing some duplicate commits:");
      console.warn(duplicateCommits.map(commit => commit.message).join("\n"));
      console.warn("\n\n\n\n");
    }
  }

  return dedupedCommits.map(commit => commit.message);
}

async function getUniquePivotalIds() {
  const messages = await getCommitMessages();

  const allPivotalIds = messages
    .map(message => /(^|\s+)\[#?(\d+)/g.exec(message))
    .filter(groups => groups && groups.length > 2)
    .map(groups => groups[2]);

  const uniquePivotalIdsMap = {};

  allPivotalIds.forEach(id => uniquePivotalIdsMap[id] = true);

  return Object.keys(uniquePivotalIdsMap);
}

function getFeatureFlagData(story) {
  if (!story.description) {
    return [];
  }

  const featureFlagNameMatches = [...story.description.matchAll(/(^|[^\w.?/])([a-z]\w+\.[a-z]\w+)([^\w.?/]|$)/gm)];

  return featureFlagNameMatches
    .filter(match => match)
    .filter(match => match.length >= 3)
    .filter(match => !!match[2])
    .map((match) => {
      const fullFeatureFlagName = match[2];

      const fullNameComponents = fullFeatureFlagName.split(/\./);

      const container = fullNameComponents[0];
      const name = fullNameComponents[1];

      return {
        fullName: fullFeatureFlagName,
        fullNameComponents: fullNameComponents,
        container: container,
        name: name,
        url: `https://app.rollout.io/app/${roxAppKey}/flags?filter=${fullFeatureFlagName}`
      };
    })
    .filter(flagData => !/^(js|ts|png|gradle|io|kt|java|hooksPath|com)$/gi.test(flagData.name));
}

function getAllUnclosedReviewsUpsourceUrl(pivotalIds) {
  return getUpsourceUrl(`branch: ${branchName} and not #{closed review} and (${pivotalIds.join(" or ")})`);
}

function getAllUnattachedCommitsUpsourceUrl() {
  return getUpsourceUrl(`branch: ${branchName} and not #{closed review} and not #{open review}`);
}

function getStoryReviewsUpsourceUrl(story) {
  return getUpsourceUrl(`branch: ${branchName} and ${story.id}`);
}

function getUpsourceUrl(query) {
  return `https://upsource.campspot.com/${upsourceProjectName}?query=${encodeURIComponent(query).replace(/\(/, "%28").replace(/\)/, "%29")}`;
}

async function getStoriesAcceptedAfterPreviousRelease() {
  if (!previousReleaseDate) {
    return [];
  }

  return await pivotalApiGetRequest(`https://www.pivotaltracker.com/services/v5/projects/${pivotalProjectId}/stories?accepted_after=${previousReleaseDate.valueOf()}`);
}

async function pivotalApiGetRequest(url) {
  const requestOptions = {
    uri: url,
    method: 'GET',
    headers: {
      accept: 'application/json',
      "X-TrackerToken": pivotalTrackerToken
    }
  };

  return await new Promise((resolve) => {
    request(requestOptions, (err, response, body) => {
      if (body) {
        resolve(JSON.parse(body));
      } else {
        resolve(null);
      }
    });
  });
}

function getStoryDisplayIndex(story) {
  switch (story.story_type) {
    case "feature":
      return 1;
    case "bug":
      return 2;
    case "chore":
      return 3;
  }
}

function sortStoryFunction(a, b) {
  return getStoryDisplayIndex(a) - getStoryDisplayIndex(b);
}

function printStoryInfo(story, options = {}) {
  let flagText = ``;

  if (options.printFlags !== false && story.hasFeatureFlagReviews) {
    if (story.flags.length > 0) {
      flagText = story.flags
        .map(flag => `[Flag (${flag.enabled ? 'on' : 'off'})](${flag.url})`)
        .join(" ");
    } else {
      flagText = `(description missing flag)`;
    }
  }

  let upsourceLink = ``;

  if (story.requiresCodeReview) {
    upsourceLink = `[Upsource](${getStoryReviewsUpsourceUrl(story)})`;
  }

  const components = [
    `#${story.id} [${story.story_type}] ${story.name.trim()}`,
    flagText,
    options.printUpsource ? upsourceLink : ''
  ];

  const storyInfo = components
    .filter(str => !!str)
    .join(" ");

  console.log(storyInfo);

  numberOfStoriesPrinted++;
}

function printListOfStories(header, stories, options = {}) {
  if (stories.length > 0) {
    stories.sort(sortStoryFunction);

    let storyCount = '';

    if (options.printStoryCount !== false) {
      storyCount = ` (${stories.length} stor${stories.length !== 1 ? 'ies' : 'y'})`;
    }

    let pointCount = '';

    if (options.printPointCount !== false) {
      const count = countEstimateSum(stories);

      pointCount = ` (${count} point${count !== 1 ? 's' : ''})`;
    }

    console.log(`&nbsp;\n&nbsp;\n&nbsp;`);
    console.log(`# ${header}${storyCount}${pointCount}:\n`);

    stories.forEach((story) => printStoryInfo(story, options));
  }
}

async function attachReviewInfoToStories(stories) {
  return await Promise.all(stories.map(async (story, i) => {
    if (args.sleep > 0) {
      await sleep(args.sleep * i);
    }

    story.reviews = await pivotalApiGetRequest(`https://www.pivotaltracker.com/services/v5/projects/${story.project_id}/stories/${story.id}/reviews`);

    if (story.reviews && Array.isArray(story.reviews)) {
      story.reviews = story.reviews.filter(review => review.kind === "review");
    } else {
      story.reviews = [];
    }

    story.codeReviews = story.reviews.filter(review => sbt.pivotal.reviewTypeIds.code.includes(review.review_type_id));
    story.qaReviews = story.reviews.filter(review => sbt.pivotal.reviewTypeIds.qa.includes(review.review_type_id));
    story.designReviews = story.reviews.filter(review => sbt.pivotal.reviewTypeIds.design.includes(review.review_type_id));
    story.featureFlagReviews = story.reviews.filter(review => sbt.pivotal.reviewTypeIds.featureFlag.includes(review.review_type_id));

    story.requiresCodeReview = story.codeReviews.length === 0 || story.codeReviews.some(review => review.status !== "pass");
    story.requiresDesignReview = story.designReviews.some(review => review.status !== "pass");
    story.requiresQAReview = (((story.story_type === "feature" && !story.isSpike) || story.story_type === "bug") && story.qaReviews.length === 0) || story.qaReviews.some(review => review.status !== "pass");

    story.hasFeatureFlagReviews = story.featureFlagReviews.length > 0;
    story.requiresFeatureFlagReview = story.featureFlagReviews.some(review => review.status !== "pass");
    story.passesFeatureFlagReview = story.hasFeatureFlagReviews && story.featureFlagReviews.every(review => review.status === "pass");
  }));
}

async function attachBlockersToStories(stories) {
  await Promise.all(stories.filter(story => !story.blockers).map(async (story) => {
    story.blockers = await pivotalApiGetRequest(`https://www.pivotaltracker.com/services/v5/projects/${story.project_id}/stories/${story.id}/blockers`);

    if (!Array.isArray(story.blockers)) {
      story.blockers = [];
    } else {
      story.blockers
        .filter(blocker => blocker.description.startsWith("#"))
        .forEach((blocker) => {
          blocker.storyIdFromDescription = parseInt(blocker.description.substr(1).trim());
        });
    }
  }));

  await addMissingStoriesFromBlockers(stories);
}

async function addMissingStoriesFromBlockers(stories) {
  const blockerStoryIds = {};
  const existingStoryIds = {};

  stories.forEach((story) => {
    existingStoryIds[story.id] = true;
  });

  stories.forEach((story) => {
    story.blockers
      .filter(blocker => blocker.storyIdFromDescription)
      .filter(blocker => !existingStoryIds[blocker.storyIdFromDescription])
      .forEach(blocker => blockerStoryIds[blocker.storyIdFromDescription] = true);
  });

  const newStoryIds = Object.keys(blockerStoryIds);

  let newStories = await Promise.all(newStoryIds.map(async (storyId) => {
    return await pivotalApiGetRequest(`https://www.pivotaltracker.com/services/v5/stories/${storyId}`);
  }));

  newStories = newStories
    .filter(story => story !== null)
    .filter(story => story.kind === "story");

  newStories.forEach((story) => {
    story.transient = true;

    stories.push(story);
  });

  if (newStories.length > 0) {
    await attachBlockersToStories(stories);
  } else {
    stories.forEach((story) => {
      story.blockers = story.blockers.map((blocker) => {
        return stories.find(s => s.id == blocker.storyIdFromDescription) || blocker;
      });
    });
  }
}

async function attachRolloutInfoToStories(stories) {
  await Rox.setup(roxApiKey);

  const containers = {};

  stories.forEach((story) => {
    story.flags = story.hasFeatureFlagReviews ? story.flags : [];

    story.flags.forEach((flag) => {
      if (!containers[flag.container]) {
        containers[flag.container] = {};
      }
      if (!containers[flag.container][flag.name]) {
        containers[flag.container][flag.name] = new Rox.Flag();
      }
    });
  });

  await Promise.all(
    Object.keys(containers)
      .map((containerName) => {
        const containerValue = containers[containerName];

        return Rox.register(containerName, containerValue);
      })
  );

  stories.forEach((story) => {
    story.flags.forEach((flag) => {
      flag.rollout = {
        container: containers[flag.container],
        flag: containers[flag.container][flag.name]
      };

      flag.enabled = flag.rollout.flag.isEnabled();
    });

    story.flagValues = story.flags.map(flag => flag.enabled);

    const storiesWithSameFlag = pivotalStories
      .filter(s => s !== story)
      .filter(s => {
        return s.flags.some((flag1) => {
          return story.flags.some((flag2) => {
            return flag1.fullName === flag2.fullName;
          });
        });
      });

    story.allStoriesWithSameFlagAccepted = storiesWithSameFlag.every(s => s.current_state === "accepted");
    story.someStoriesWithSameFlagAccepted = storiesWithSameFlag.some(s => s.current_state === "accepted");
    story.noStoriesWithSameFlagAccepted = storiesWithSameFlag.every(s => s.current_state !== "accepted");

    const storiesWithSameFlagIncludingSelf = [story, ...storiesWithSameFlag];

    story.allStoriesWithSameFlagAcceptedIncludingSelf = storiesWithSameFlagIncludingSelf.every(s => s.current_state === "accepted");
    story.someStoriesWithSameFlagAcceptedIncludingSelf = storiesWithSameFlagIncludingSelf.some(s => s.current_state === "accepted");
    story.noStoriesWithSameFlagAcceptedIncludingSelf = storiesWithSameFlagIncludingSelf.every(s => s.current_state !== "accepted");
  });
}

function attachFlagInfoToStories(stories) {
  stories.forEach((story) => {
    story.flags = getFeatureFlagData(story);
  });

  return stories;
}

function countEstimateSum(stories) {
  return stories.reduce((a, b) => {
    if (!isNaN(a.estimate)) {
      return a.estimate + (b.estimate || 0);
    } else {
      return (a || 0) + (b.estimate || 0)
    }
  }, 0);
}

function storyIsClosedOutAndCarriedOver(story) {
  return story.labels.some(label => label.kind === "label" && label.name === "close out and carry over");
}

function storyIsConsumer(story) {
  return story.labels.some(label => label.kind === "label" && (label.name === "new consumer" || label.name === "consumer"));
}

function storyIsAggregator(story) {
  return story.labels.some(label => label.kind === "label" && (label.name === "prototype" || label.name === "aggregator"));
}

function storyIsSpike(story) {
  return story.labels.some(label => label.kind === "label" && label.name === "spike");
}

function storyIsObsolete(story) {
  return story.labels.some(label => label.kind === "label" && label.name === "obsolete");
}

function filterStoriesByWhereClause(stories, whereClause) {
  filterFuncsForWhereClause(whereClause).forEach((func) => {
    stories = stories.filter(story => func(story));
  });

  return stories;
}

function filterFuncsForWhereClause(whereClause) {
  // [
  //   {
  //     "equals": {
  //       "story_type": "feature",
  //       "current_state": "accepted"
  //     }
  //   },
  //   {
  //     "or": [
  //       {
  //         "equals": {
  //           "hasFeatureFlagReviews": false
  //         }
  //       },
  //       {
  //         "every": {
  //           "flagValues": true
  //         }
  //       }
  //     ]
  //   }
  // ]

  return whereClause.map((clause) => {
    // "or": [
    //   {
    //     "equals": {
    //       "hasFeatureFlagReviews": false
    //     }
    //   },
    //   {
    //     "every": {
    //       "flagValues": true
    //     }
    //   }
    // ]

    // "equals": {
    //   "story_type": "feature",
    //   "current_state": "accepted"
    // }

    const commands = Object.keys(clause);
    // ["equals", "or"]

    return commands.map((command) => {
      // "equals"

      // "or"

      const currentCommand = clause[command];

      // equals:
      // {
      //   "story_type": "feature",
      //   "current_state": "accepted"
      // }

      // or:
      // [
      //   {
      //     "equals": {
      //       "hasFeatureFlagReviews": false
      //     }
      //   },
      //   {
      //     "every": {
      //       "flagValues": true
      //     }
      //   }
      // ]

      // every:
      // {
      //   "flagValues": true
      // }

      const properties = Object.entries(currentCommand);

      // equals:
      // [
      //   {"story_type": "feature"},
      //   {"current_state": "accepted"}
      // ]

      // or:
      // N/A

      // every:
      // [
      //   {"flagValues": true}
      // ]

      switch (command) {
        case "not":
          return (x) => properties.every(([key, value]) => {
            return !filterFuncsForWhereClause(value).every(y => y(x));
          });
        case "equals":
          return (x) => properties.every(([key, value]) => {
            return value === x[key];
          });
        case "or":
          return (x) => currentCommand.some((value) => {
            // {
            //   "equals": {
            //     "hasFeatureFlagReviews": false
            //   }
            // }

            // {
            //   "every": {
            //     "flagValues": true
            //   }
            // }

            return filterFuncsForWhereClause([value]).every(y => y(x));
          });
        case "some":
        case "includes":
          return (x) => properties.every(([key, value]) => {
            const data = x[key];

            if (Array.isArray(value)) {
              if (Array.isArray(data)) {
                return data.some(d => value.includes(d));
              } else {
                return value.includes(data);
              }
            } else {
              if (Array.isArray(data)) {
                return data.some(d => value === d);
              } else {
                return value === data;
              }
            }
          });
        case "every":
          return (x) => properties.every(([key, value]) => {
            // ["flagValues", true]
            const data = x[key];

            if (Array.isArray(data)) {
              return data.every(d => value === d);
            } else {
              return value === data;
            }
          });
        default:
          console.error(`Invalid command '${command}'`);
          process.exit(1);
          break;
      }
    });
  }).flat();
}

async function getReleaseInfo() {
  const uniquePivotalIds = await getUniquePivotalIds();

  const pivotalStoriesIncludingNull = await Promise.all(uniquePivotalIds.map((id) => {
    return pivotalApiGetRequest(`https://www.pivotaltracker.com/services/v5/stories/${id}`);
  }));

  const allPivotalStories = pivotalStoriesIncludingNull
    .filter(story => story !== null)
    .filter(story => story.kind === "story");

  const storiesAcceptedAfterPreviousRelease = await getStoriesAcceptedAfterPreviousRelease();

  storiesAcceptedAfterPreviousRelease
    .filter(story => !args.skipStoryIds || !args.skipStoryIds.includes(story.id))
    .filter(story => allPivotalStories.every(s => s.id !== story.id))
    .filter(story => Date.parse(story.accepted_at) >= currentReleaseDate)
    .forEach((story) => {
      allPivotalStories.push(story);
    });

  allPivotalStories.forEach((story) => {
    story.labelNames = story.labels.map(label => label.name);

    story.isConsumer = storyIsConsumer(story);
    story.isAggregator = storyIsAggregator(story);
    story.isSpike = storyIsSpike(story);
    story.isObsolete = storyIsObsolete(story);
    story.accepted = story.current_state === "accepted";
  });

  pivotalStories = allPivotalStories
    .filter(story => !storyIsClosedOutAndCarriedOver(story))
    .filter(story => !story.isObsolete);

  await attachBlockersToStories(pivotalStories);

  attachFlagInfoToStories(pivotalStories);

  await attachReviewInfoToStories(pivotalStories);
  await attachRolloutInfoToStories(pivotalStories);

  const storiesOnRelease = pivotalStories.filter(story => !story.transient);

  const features = storiesOnRelease.filter(story => story.story_type === "feature");
  const chores = storiesOnRelease.filter(story => story.story_type === "chore");
  const bugs = storiesOnRelease.filter(story => story.story_type === "bug");

  const featureEstimationSum = countEstimateSum(features);
  const choreEstimationSum = countEstimateSum(chores);
  const bugEstimationSum = countEstimateSum(bugs);

  console.log(`${features.length} Feature${features.length === 1 ? '' : 's'} (${featureEstimationSum} point${featureEstimationSum === 1 ? '' : 's'})`);
  console.log(`${chores.length} Chore${chores.length === 1 ? '' : 's'} (${choreEstimationSum} point${choreEstimationSum === 1 ? '' : 's'})`);
  console.log(`${bugs.length} Bug${bugs.length === 1 ? '' : 's'} (${bugEstimationSum} point${bugEstimationSum === 1 ? '' : 's'})`);

  if (sbt.sections) {
    sbt.sections.forEach((section) => {
      let stories = storiesOnRelease;

      if (section.stories) {
        switch (section.stories) {
          case "all":
            stories = allPivotalStories;
            break;
          default:
            console.error(`Invalid stories value '${section.stories}'`);
            process.exit(1);
            break;
        }
      }

      const sectionStories = filterStoriesByWhereClause(stories, section.where);

      if (section.attach) {
        sectionStories.forEach(story => story[section.attach.key] = section.attach.value);
      }

      printListOfStories(
        section.header,
        sectionStories,
        section.options
      );
    });
  }

  console.log(`&nbsp;\n&nbsp;\n&nbsp;\n# Upsource:\n`);
  console.log(`[Commits with open or no reviews](${getAllUnclosedReviewsUpsourceUrl(uniquePivotalIds)})`);
  console.log(`[Commits with no attached review](${getAllUnattachedCommitsUpsourceUrl()})`);
}

function runCommand(command, commandOptions, options) {
  options = options || {};
  options.throwErrorOnNonZeroExit = typeof options.throwErrorOnNonZeroExit === 'undefined' ? true : options.throwErrorOnNonZeroExit;
  options.quiet = typeof options.quiet === 'undefined' ? false : options.quiet;

  const spawnOptions = {};

  if (!options.quiet) {
    spawnOptions.stdio = [null, process.stdout, process.stderr];
  }
  if (options.cwd) {
    spawnOptions.cwd = options.cwd;
  }

  const resp = spawnSync(
    command,
    commandOptions,
    spawnOptions
  );

  if (options.throwErrorOnNonZeroExit && resp.status !== 0) {
    throw new Error(`Error running command '${command} ${commandOptions.map(it => `"${it}"`).join(" ")}': ` + String(resp.stderr));
  }

  return resp;
}

function hasUncommitedChanges(cwd) {
  let response = runCommand(
    'git',
    [`update-index`, `--refresh`],
    {
      throwErrorOnNonZeroExit: false,
      quiet: true,
      cwd: cwd
    }
  );

  return runCommand(
    'git',
    [`diff-index`, `--quiet`, `HEAD`, `--`],
    {
      throwErrorOnNonZeroExit: false,
      cwd: cwd
    }
  ).status === 1;
}

function getCurrentReleaseBranchName() {
  return String(runCommand('git', [`rev-parse`, `--abbrev-ref`, `HEAD`], {cwd: repoPath, quiet: true}).stdout).trim();
}

function getBranchHead(branchName, path) {
  path = typeof path === 'undefined' ? repoPath : path;

  return String(runCommand('git', [`rev-parse`, branchName], {cwd: path, quiet: true}).stdout).trim();
}

function waitForYnResponse(message) {
  let answer;

  do {
    answer = readlineSync.question(`${message} `).trim().toLowerCase();
  } while (answer !== 'y' && answer !== 'n');

  return answer === 'y';
}

function checkAndAskToCreateRepo() {
  if (!fs.existsSync(repoPath)) {
    const yes = waitForYnResponse(`Repo at path '${repoPath}' does not exist. Create it? (y/n)`);

    if (!yes) {
      console.log("Fine. do it yourself.");
      process.exit(1);
    } else {
      let repoName;

      const targetRepoPath = repoPath === '.' ? process.cwd() : repoPath;

      const lastSlashIndex = targetRepoPath.lastIndexOf('/');

      if (lastSlashIndex >= 0) {
        repoName = targetRepoPath.substring(lastSlashIndex + 1, targetRepoPath.length);
      } else {
        repoName = targetRepoPath;
      }

      const cwd = resolve(`${repoPath}/..`);

      runCommand('git', [`clone`, repoUrl, `--branch`, stagingBranchName, repoName], {cwd: cwd, quiet: true});
    }
  }
}

async function createRelease() {
  if (!args.releaseBranchName) {
    if (!args.continue) {
      console.error(`Missing required argument: release-branch-name`);
      process.exit(1);
    } else {
      args.releaseBranchName = getCurrentReleaseBranchName();
    }
  }

  try {
    checkAndAskToCreateRepo();

    git = gitFunc(repoPath);

    let latestCommitHash = "HEAD";

    if (sbt.releases.length > 0 && sbt.releases[sbt.releases.length - 1].to === "HEAD") {
      latestCommitHash = sbt.releases[sbt.releases.length - 1].from;
    } else if (sbt.releases.length > 1) {
      latestCommitHash = sbt.releases[sbt.releases.length - 2].to;
    }

    runCommand('git', [`checkout`, branchName], {cwd: repoPath, quiet: true});

    if (!args.continue && !args.dry) {
      runCommand('git', [`pull`], {cwd: repoPath, quiet: true});
    }

    let commits = await git.log({from: latestCommitHash, to: "HEAD"});

    args.storyIds = args.storyIds || [];
    args.commitHashes = args.commitHashes || [];
    args.skipStoryIds = args.skipStoryIds || [];
    args.skipCommitHashes = args.skipCommitHashes || [];

    const commitsForStory = commits.all
      .filter((commit) => {
        return args.storyIds.some(id => commit.message.indexOf(id) >= 0) ||
          args.commitHashes.some(hash => commit.hash.indexOf(hash) >= 0);
      })
      .filter((commit) => {
        return args.skipStoryIds.every(id => commit.message.indexOf(id) === -1) &&
          args.skipCommitHashes.every(hash => commit.hash.indexOf(hash) === -1);
      })
      .reverse();

    if (commitsForStory.length === 0) {
      console.error(`There are no undeployed commits relating to stories #${args.storyIds}`);
      process.exit(1);
    }

    if (!args.continue && !args.dry) {
      runCommand('git', [`checkout`, stagingBranchName], {cwd: repoPath, quiet: true});
      runCommand('git', [`pull`], {cwd: repoPath, quiet: true});
      runCommand('git', [`checkout`, `-b`, args.releaseBranchName], {cwd: repoPath, quiet: true});
    } else {
      runCommand('git', [`checkout`, args.releaseBranchName], {cwd: repoPath, quiet: true});
    }

    commitsForStory.forEach((commit) => {
      const cherryPick = runCommand('git', [`cherry-pick`, commit.hash], {cwd: repoPath, quiet: true, throwErrorOnNonZeroExit: false});

      if (cherryPick.status !== 0) {
        if (args.autoResolveConflicts) {
          runCommand('git', [`add`, `.`], {cwd: repoPath, quiet: true});
          runCommand('git', [`commit`, `-m`, `Merge commit for release info`], {cwd: repoPath, quiet: true});
        } else {
          if (!waitForYnResponse("Please resolve conflicts and then continue by pressing 'y', or 'n' to quit.")) {
            process.exit(1);
          }

          while (hasUncommitedChanges(repoPath)) {
            if (!waitForYnResponse("Please commit the resolved conflicts (`git add . && git cherry-pick --continue`) and then continue by pressing 'y', or 'n' to quit.")) {
              process.exit(1);
            }
          }
        }
      }
    });

    if (args.push) {
      runCommand('git', [`push`, `origin`, args.releaseBranchName], {cwd: repoPath, quiet: true});
    }
  } catch (e) {
    console.error(`Failed to create release:`, e);
    process.exit(1);
  }
}

async function pullReleaseInfo() {
  if (!sbtJsonExists()) {
    console.error(`No sbt.json file present in current working directory: '${process.cwd()}'`);
    process.exit(1);
  }

  if (args.quick) {
    args.autoResolveConflicts = true;
  }

  try {
    checkAndAskToCreateRepo();

    let releaseBranchName = args.releaseBranchName;
    const currentReleaseBranchName = getCurrentReleaseBranchName();

    if (args.continue && currentReleaseBranchName === stagingBranchName) {
      console.error(`Cannot continue release info when on ${stagingBranchName} branch in release repo. Either checkout a release branch, or start the release info command from scratch.`);
      process.exit(1);
    }

    if (!releaseBranchName) {
      if (args.continue || args.dry) {
        releaseBranchName = currentReleaseBranchName;
      } else {
        releaseBranchName = uuid();
      }
    }

    if (!args.continue && !args.dry) {
      runCommand('git', [`checkout`, stagingBranchName], {cwd: repoPath, quiet: true});
      runCommand('git', [`pull`], {cwd: repoPath, quiet: true});
      runCommand('git', [`checkout`, `-b`, releaseBranchName], {cwd: repoPath, quiet: true});

      const merge = runCommand('git', [`merge`, `origin/${branchName}`], {cwd: repoPath, quiet: true, throwErrorOnNonZeroExit: false});

      if (merge.status !== 0) {
        if (args.autoResolveConflicts) {
          runCommand('git', [`add`, `.`], {cwd: repoPath, quiet: true});
          runCommand('git', [`commit`, `-m`, `Merge commit for release info`], {cwd: repoPath, quiet: true});
        } else {
          console.error(`Please resolve conflicts and then continue the release by running: '${args.$0} release --continue'`)
          process.exit(1);
        }
      }
    }

    if (args.continue && !args.dry && args.autoResolveConflicts && hasUncommitedChanges(repoPath)) {
      runCommand('git', [`add`, `.`], {cwd: repoPath, quiet: true});
      runCommand('git', [`commit`, `-m`, `Merge commit for release info`], {cwd: repoPath, quiet: true});
    }

    await getReleaseInfo();

    if (args.push) {
      runCommand('git', [`push`, `origin`, releaseBranchName], {cwd: repoPath, quiet: true});
    }

    if (!args.dry) {
      runCommand('git', [`checkout`, stagingBranchName], {cwd: repoPath, quiet: true});

      if (!args.continue) {
        runCommand('git', [`branch`, `-D`, releaseBranchName], {cwd: repoPath, quiet: true});
      }
    }
  } catch (e) {
    console.error(`Failed to pull release info:`, e);
    process.exit(1);
  }
}

async function testPush() {
  const prefix = await storage.getItem('TEST_BRANCH_NAME_PREFIX')

  if (typeof prefix === 'undefined') {
    console.error(`No prefix set for test branch name.\nPlease think of a unique prefix that will not clash with WIP test branch prefixes, as well as anyone else working in this repo. e.g. "test/braden-".\nYou can set the test branch prefix by running:\n${args.$0} config --test-branch-prefix="test/my-prefix-blah-"`);
    process.exit(1);
  }

  let branchId;

  try {
    const currentBranchIdValue = parseInt(await storage.getItem('BRANCH_ID'));

    branchId = (currentBranchIdValue || 0) + 1;

    await storage.setItem('BRANCH_ID', branchId);

    const hasChanges = hasUncommitedChanges();

    if (args.stash && hasChanges) {
      runCommand('git', [`add`, `.`]);
      runCommand('git', [`stash`]);
    }

    if (args.pull !== false) {
      runCommand('git', [`pull`]);
    }

    runCommand('git', [`checkout`, `-b`, `${prefix}${branchId}`]);
    runCommand('git', [`push`]);
    runCommand('git', [`checkout`, `@{-1}`]);

    if (args.stash && hasChanges) {
      runCommand('git', [`stash`, `pop`]);
    }
  } catch (e) {
    console.error("Failed to test push");
    process.exit(1);
  }

  console.log(`Successfully pushed test branch to: ${prefix}${branchId}`)
}

async function rebaseOnMaster() {
  try {
    runCommand('git', [`checkout`, branchName]);
    runCommand('git', [`pull`]);
    runCommand('git', [`checkout`, `@{-1}`]);
    runCommand('git', [`rebase`, branchName]);
    runCommand('git', [`checkout`, branchName]);
    runCommand('git', [`merge`, `@{-1}`]);
  } catch (e) {
    console.error(`Failed to rebase on ${branchName}`);
    process.exit(1);
  }

  console.log(`Successfully rebased on ${branchName}`)
}

function updatesAvailable() {
  runCommand('git', [`fetch`], {cwd: __dirname, quiet: true});

  const localHead = getBranchHead("HEAD", __dirname);
  const remoteHead = getBranchHead("origin/master", __dirname);

  return localHead !== remoteHead;
}

function upgrade() {
  try {
    if (updatesAvailable()) {
      console.log(`Already up to date`);
      process.exit(2);
    }

    if (args.y || waitForYnResponse(`Updates are available. Install them? (y/n)`)) {
      runCommand('git', [`pull`, `--rebase`], {cwd: __dirname, quiet: true});
      runCommand('npm', [`uninstall`, `.`, `-g`], {cwd: __dirname, quiet: true});
      runCommand('npm', [`install`, `.`, `-g`], {cwd: __dirname, quiet: true});

      console.log(`Successfully upgraded`);
    } else {
      console.log(`Not upgrading`);
    }
  } catch (e) {
    console.error(`Failed to upgrade`);
    console.error(e);
    process.exit(1);
  }
}

function checkUpdates(quietOnUpToDate) {
  if (updatesAvailable()) {
    console.log(`There are updates available. Run '${args.$0} upgrade' to install them.`);
  } else if (!quietOnUpToDate) {
    console.log("Already up to date");
  }
}

async function wipPush() {
  const prefix = await storage.getItem('WIP_BRANCH_NAME_PREFIX')

  if (typeof prefix === 'undefined') {
    console.error(`No prefix set for WIP branch name.\nPlease think of a unique prefix that will not clash with normal test branch prefixes, as well as anyone else working in this repo. e.g. "test/braden-wip-".\nYou can set the test branch prefix by running:\n${args.$0} config --wip-branch-prefix="test/my-wip-prefix-blah-"`);
    process.exit(1);
  }

  let branchId;

  try {
    const currentBranchIdValue = parseInt(await storage.getItem('WIP_BRANCH_ID'));

    branchId = (currentBranchIdValue || 0) + 1;

    await storage.setItem('WIP_BRANCH_ID', branchId);

    const hasChanges = hasUncommitedChanges();

    runCommand('git', [`checkout`, `-b`, `${prefix}${branchId}`]);

    if (hasChanges) {
      runCommand('git', [`add`, `.`]);
      runCommand('git', [`commit`, `-m`, `WIP test branch progress`]);
    }

    runCommand('git', [`push`]);

    if (hasChanges) {
      runCommand('git', [`reset`, `HEAD~`]);
    }

    runCommand('git', [`checkout`, `@{-1}`]);
  } catch (e) {
    console.error("Failed to WIP push");
    process.exit(1);
  }

  console.log(`Successfully pushed WIP branch to: ${prefix}${branchId}`)
}

async function config() {
  if (args.hasOwnProperty("branchId")) {
    if (typeof args.branchId === 'undefined') {
      console.log(await storage.getItem("BRANCH_ID"))
    } else {
      await storage.setItem("BRANCH_ID", args.branchId);
    }
  }
  if (args.hasOwnProperty("wipBranchId")) {
    if (typeof args.wipBranchId === 'undefined') {
      console.log(await storage.getItem("WIP_BRANCH_ID"))
    } else {
      await storage.setItem("WIP_BRANCH_ID", args.wipBranchId);
    }
  }
  if (args.hasOwnProperty("testBranchPrefix")) {
    if (!args.testBranchPrefix) {
      console.log(await storage.getItem("TEST_BRANCH_NAME_PREFIX"))
    } else {
      await storage.setItem("TEST_BRANCH_NAME_PREFIX", args.testBranchPrefix);
    }
  }
  if (args.hasOwnProperty("wipBranchPrefix")) {
    if (!args.wipBranchPrefix) {
      console.log(await storage.getItem("WIP_BRANCH_NAME_PREFIX"))
    } else {
      await storage.setItem("WIP_BRANCH_NAME_PREFIX", args.wipBranchPrefix);
    }
  }
}

async function main() {
  if (!sbtJsonExists()) {
    await storage.init({
      dir: resolve(`${process.env.HOME}/.node-persist`)
    });
  } else {
    await storage.init();
  }

  let command;

  const yargs = require('yargs');

  args = {};

  initializeSbtInfo();

  args = yargs
    .usage('Usage: $0 <command> [options]')
    .command(
      ['release-info'], 'Generate release info',
      () => {
        return yargs
          .option('no-duplicate-header', {
            alias: 'no-dupes',
            type: 'boolean',
            description: 'Do not print duplicate stories that are being removed before the output'
          })
          .option('sleep', {
            alias: 's',
            type: 'number',
            description: 'Number of milliseconds to sleep between fetching info for pivotal stories'
          })
          .option('repo-path', {
            type: 'string',
            description: 'Path to git repo to pull version info from'
          })
          .option('just-info', {
            alias: ['dry', 'd'],
            type: 'boolean',
            description: branchName ?
              `Do not checkout release branch and merge origin/${branchName} automatically` :
              `Do not checkout release branch and merge the main branch's origin automatically`
          })
          .option('continue', {
            alias: 'c',
            type: 'boolean',
            description: `Continue pulling release info after addressing conflicts manually`
          })
          .option('skip-story-ids', {
            type: 'array',
            description: 'What stories to exclude in the release'
          })
          .option('skip-commit-hashes', {
            type: 'array',
            description: 'What commits to exclude in the release'
          })
          .option('auto-resolve-conflicts', {
            alias: 'arc',
            type: 'boolean',
            description: `Automatically resolve conflicts and create a merge commit (not correctly, though)`
          })
          .option('quick', {
            type: 'boolean',
            description: `Just quickly get the most up to date release info by creating a temp branch, then deleting it afterwards`
          })
          .option('push', {
            type: 'boolean',
            description: `On successfully pulling release info, push the created branch`
          });
      }, () => command = 'release-info'
    )
    .command(
      ['create-release'], 'Cherry-pick commits related to a story to a specific branch for a release',
      () => {
        return yargs
          .option('release-branch-name', {
            type: 'string',
            description: 'What to name the branch the release will be created on'
          })
          .option('story-ids', {
            type: 'array',
            description: 'What stories to include in the release'
          })
          .option('commit-hashes', {
            type: 'array',
            description: 'What commits to include in the release'
          })
          .option('skip-story-ids', {
            type: 'array',
            description: 'What stories to exclude in the release'
          })
          .option('skip-commit-hashes', {
            type: 'array',
            description: 'What commits to exclude in the release'
          })
          .option('repo-path', {
            type: 'string',
            description: 'Path to git repo to create release from'
          })
          .option('continue', {
            alias: 'c',
            type: 'boolean',
            description: `Continue cherry-picking after addressing conflicts manually`
          })
          .option('auto-resolve-conflicts', {
            alias: 'arc',
            type: 'boolean',
            description: `Automatically resolve conflicts and create a merge commit (not correctly, though)`
          })
          .option('push', {
            type: 'boolean',
            description: `On successfully creating release branch and cherry-picking commits, push the created branch`
          });
      }, () => command = 'create-release'
    )
    .command(
      ['wip-push', 'wp'],
      'Push current staged and unstaged changes to wip git branch, but do not commit',
      () => {
      },
      () => command = 'wip-push'
    )
    .command(
      ['test-push', 'tp'],
      'Push current committed changes to a test git branch',
      () => {
        return yargs
          .option('stash', {
            type: 'boolean',
            description: 'Stash changes before pushing test branch, and unstash them after pushing'
          })
          .option(`no-pull`, {
            type: 'boolean',
            description: branchName ?
              `Do not pull changes from origin/${branchName} before creating test branch` :
              `Do not pull changes from the main branch's origin before creating test branch`
          });
      },
      () => command = 'test-push'
    )
    .command(
      [`rebase-on-main`],
      branchName ?
        `Rebase current branch onto the main branch (${branchName}) and fast-forward ${branchName} with new commits` :
        `Rebase current branch onto the main branch and fast-forward the main branch with new commits`,
      () => {
      },
      () => command = `rebase-on-main`
    )
    .command(
      [`upgrade`],
      `Check for any updates and install them`,
      () => {
        return yargs
          .option('y', {
            type: 'boolean',
            description: `Auto respond 'yes' to any prompts`
          });
      },
      () => command = `upgrade`
    )
    .command(
      [`check-updates`],
      `Check for any updates`,
      () => {
      },
      () => command = `check-updates`
    )
    .command(
      ['config'],
      'Configure settings for current environment and storage',
      () => {
        return yargs
          .option('branch-id', {
            type: 'number',
            description: 'ID of the most recently published test branch'
          })
          .option('wip-branch-id', {
            type: 'number',
            description: 'ID of the most recently published WIP branch'
          })
          .option('test-branch-prefix', {
            type: 'string',
            description: 'Prefix for branch names generated from test pushes'
          })
          .option('wip-branch-prefix', {
            type: 'string',
            description: 'Prefix for branch names generated from WIP pushes'
          });
      },
      () => command = 'config'
    )
    .example('$0 release-info', 'Generate release info to stdout');

  const commands = args.getCommandInstance().getCommands();

  args = args.argv;

  if (!command || (args._[0] && !commands.includes(args._[0]))) {
    console.error(`Invalid command. Run '${args.$0} --help' for help.`);
    process.exit(1);
  }

  checkUpdates(true);

  initializeSbtInfo();

  switch (command) {
    case 'release-info':
      await pullReleaseInfo();
      break;
    case 'create-release':
      await createRelease();
      break;
    case 'wip-push':
      await wipPush();
      break;
    case 'test-push':
      await testPush();
      break;
    case `rebase-on-main`:
      await rebaseOnMaster();
      break;
    case `upgrade`:
      await upgrade();
      break;
    case `check-updates`:
      await checkUpdates();
      break;
    case 'config':
      await config();
      break;
  }
}

main().then(() => {
  process.exit();
});
