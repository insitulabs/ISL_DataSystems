const Source = require('../db/source');
const OdkClient = require('../lib/odkClient');
const crypto = require('../lib/crypto');

let debugging = true;
function debug() {
  if (debugging) {
    console.log.apply(console.log, arguments);
  }
}

/**
 * Sync a workspace with ODK.
 * @param {object} workspace
 * @param {Source} sourceManager
 */
module.exports = async function (workspace, sourceManager, SOURCE_SYSTEM = 'ODK') {
  if (!workspace?.sync?.enabled || workspace?.sync?.type !== 'ODK') {
    throw new Error('Sync not enabled for workspace: ' + workspace.name);
  }

  debug(`[${workspace.name}] sync-odk-submissions START`, new Date());

  let odkClient = new OdkClient(
    workspace.sync.url,
    workspace.sync.user,
    crypto.decrypt(workspace.sync.password)
  );

  let projects = await odkClient.getProjects();
  projects.sort((a, b) => {
    return a.id - b.id;
  });
  projects.forEach((p) => {
    p.forms.sort((a, b) => {
      return a.xmlFormId.toLowerCase().localeCompare(b.xmlFormId.toLowerCase());
    });
  });

  let sourceCandidates = [];
  projects.forEach((p) => {
    p.forms.forEach((f) => {
      if (!f.submissions || f.state !== 'open') {
        debug(`Skip empty or closed form: ${p.id} - ${f.xmlFormId}`);
        return;
      }
      sourceCandidates.push({
        name: p.name + ' - ' + f.name,
        system: SOURCE_SYSTEM,
        namespace: `${p.id} - ${f.xmlFormId}`
      });
    });
  });

  let sources = {};
  for (let candidate of sourceCandidates) {
    let source = null;
    try {
      source = await sourceManager.getSourceByName(candidate.system, candidate.namespace);
    } catch (error) {
      // Silence not found
    }

    if (!source) {
      source = await sourceManager.createSource({
        name: candidate.name,
        system: candidate.system,
        namespace: candidate.namespace,
        fields: []
      });
    }

    sources[source.submissionKey] = source;
  }

  // log(sources);
  for (let project of projects) {
    for (let form of project.forms) {
      const SOURCE_NAMESPACE = `${project.id} - ${form.xmlFormId}`;
      let lastSubmission = new Date(form.lastSubmission);
      let source = sources[Source.submissionKey(SOURCE_SYSTEM, SOURCE_NAMESPACE)];

      if (!source) {
        continue;
      }

      let lastSync = source.lastSync;
      try {
        if (!lastSync || (lastSync.lastSubmission && lastSync.lastSubmission < lastSubmission)) {
          let submissions = await odkClient.getSubmissions(project.id, form.xmlFormId);
          const inserted = await sourceManager.insertSubmissions(source, submissions, {
            originIdKey: '_originId',
            createdKey: '_created'
          });

          debug(`${SOURCE_NAMESPACE}: Submission Inserted: ${inserted}`);
          await sourceManager.setLastSync(source, {
            date: new Date(),
            lastSubmission,
            inserted,
            status: 'SUCCESS'
          });
        } else {
          debug(
            `${SOURCE_NAMESPACE}: No New Submissions since [${lastSync.date.toISOString()}]. Last Submission [${lastSubmission.toISOString()}].`
          );
        }
      } catch (error) {
        debug(error);
        await sourceManager.setLastSync(source, {
          date: new Date(),
          lastSubmission,
          inserted: 0,
          status: 'ERROR',
          error: error && error.message ? error.message : error
        });
      }
    }
  }
  debug(`[${workspace.name}] sync-odk-submissions END`, new Date());
};

