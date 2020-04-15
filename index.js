#!/usr/bin/env node

const fs = require('fs');
const sbt = JSON.parse(fs.readFileSync(`${process.cwd()}/sbt.json`, 'utf8'));

const gitFunc = require("simple-git/promise");
const request = require("request");
const Rox = require("rox-node");

const pivotalProjectId = sbt.pivotal.projectId;
const roxApiKey = sbt.rox.apiKey;
const roxAppKey = sbt.rox.appKey;
const upsourceProjectName = sbt.upsourceProjectName;
const pivotalTrackerToken = sbt.pivotal.trackerToken;
const repoPath = sbt.repoPath || ".";
const branchName = sbt.branchName || "master";

const git = gitFunc(repoPath);

let numberOfStoriesPrinted = 0;
let previousReleaseDate = null;
let currentReleaseDate = null;

let args;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCommitMessages() {
  const pastReleases = sbt.releases.slice(0, sbt.releases.length - 1);
  const currentRelease = sbt.releases[sbt.releases.length - 1];

  const previousReleaseCommitLogs = await Promise.all(
    pastReleases.map(release => git.log({from: release.from, to: release.to}))
  );

  const releaseCommits = await git.log({from: currentRelease.from, to: currentRelease.to});
  const lastRelease = previousReleaseCommitLogs[previousReleaseCommitLogs.length - 1];

  let dedupedCommits = releaseCommits.all;

  if (lastRelease) {
    previousReleaseDate = Date.parse(lastRelease.latest.date);
    currentReleaseDate = Date.parse(releaseCommits.all[releaseCommits.total - 1].date);

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
    .filter(flagData => !/^(js|ts|png|gradle|io|kt|java|hooksPath)$/gi.test(flagData.name));
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

  if (story.hasFeatureFlagReviews) {
    if (story.flags.length > 0) {
      flagText = story.flags
        .map(flag => `[Flag (${flag.enabled ? 'on' : 'off'})](${flag.url})`)
        .join(" ");
    } else {
      flagText = `(description missing flag)`;
    }
  } else {
    flagText = `(no flags)`;
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

    console.log(`&nbsp;\n&nbsp;\n&nbsp;`);
    console.log(`# ${header}:\n`);

    stories.forEach((story) => printStoryInfo(story, options));
  }
}

async function attachReviewInfoToStories(stories) {
  return await Promise.all(stories.map(async (story, i) => {
    // await sleep(5000 * i);

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
  return whereClause.map((clause) => {
    const commands = Object.keys(clause);

    return commands.map((command) => {
      const currentCommand = clause[command];
      const properties = Object.entries(currentCommand);

      switch (command) {
        case "not":
          return (x) => properties.every(([key, value]) => {
            return !filterFuncsForWhereClause(value).every(y => y(x));
          });
        case "equals":
          return (x) => properties.every(([key, value]) => {
            return value === x[key];
          });
        case "includes":
          return (x) => properties.every(([key, value]) => {
            const data = x[key];

            if (Array.isArray(data)) {
              return data.some(d => value.includes(d));
            } else {
              return value.includes(data);
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
  });

  const pivotalStories = allPivotalStories
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

  printListOfStories(
    "Stories to have flags turned on",
    pivotalStories
      .filter(story => story.current_state === "accepted")
      .filter(story => story.flags.some(flag => !flag.enabled))
      .filter(story => {
        const storiesWithSameFlag = pivotalStories
          .filter(s => s !== story)
          .filter(s => {
            return s.flags.some((flag1) => {
              return story.flags.some((flag2) => {
                return flag1.fullName === flag2.fullName;
              });
            });
          });

        return storiesWithSameFlag.every(s => s.current_state === "accepted");
      })
  );

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
        sectionStories
      );
    });
  }

  printListOfStories(
    "Stories requiring code review",
    storiesOnRelease.filter(story => story.requiresCodeReview),
    {
      printUpsource: true
    }
  );

  printListOfStories(
    "Stories requiring QA review",
    storiesOnRelease
      .filter(story => story.requiresQAReview)
      .filter(story => !story.hasFeatureFlagReviews)
  );

  printListOfStories(
    "Stories requiring design review",
    storiesOnRelease
      .filter(story => story.requiresDesignReview)
      .filter(story => !story.hasFeatureFlagReviews)
      .filter(story => !story.isAggregator)
  );

  printListOfStories(
    "Stories requiring feature flag reviews",
    storiesOnRelease.filter(story => story.requiresFeatureFlagReview)
  );

  console.log(`&nbsp;\n&nbsp;\n&nbsp;\n# Upsource:\n`);
  console.log(`[Commits with open or no reviews](${getAllUnclosedReviewsUpsourceUrl(uniquePivotalIds)})`);
  console.log(`[Commits with no attached review](${getAllUnattachedCommitsUpsourceUrl()})`);
}

function main() {
  return new Promise((resolve, reject) => {
    let releaseInfo = false

    args = require('yargs')
      .usage('Usage: $0 <command> [options]')
      .command('release', 'Generate release info to stdout', () => releaseInfo = true)
      .option('no-duplicate-header', {
        alias: 'no-dupes',
        type: 'boolean',
        description: 'Do not print duplicate stories that are being removed before the output'
      })
      .example('$0 release', 'Generate release info to stdout')
      .argv;

    releaseInfo = releaseInfo || args._.length === 0;

    if (releaseInfo) {
      getReleaseInfo().then(() => {
        resolve();
      }).catch((err) => {
        reject(err);
      });
    } else {
      console.log(`Invalid command. Run '${args.$0} --help' for help.`);
      resolve();
    }
  });
}

main().then(() => {
  process.exit();
});
