const Uploader = require('../lib/uploader');
const OdkClient = require('../lib/odkClient');
const crypto = require('../lib/crypto');
const Source = require('../db/source');

let debugging = true;
function debug() {
  if (debugging) {
    console.log.apply(console.log, arguments);
  }
}

/**
 * Sync ODK attachments with a workspace.
 * @param {object} workspace
 * @param {Source} sourceManager
 */
module.exports = async function (workspace, sourceManager) {
  if (!workspace?.sync?.enabled || workspace?.sync?.type !== 'ODK') {
    throw new Error('Sync not enabled for workspace: ' + workspace.name);
  }

  debug('odk-sync-attachments START', new Date());
  const uploader = new Uploader();

  let odkClient = new OdkClient(
    workspace.sync.url,
    workspace.sync.user,
    crypto.decrypt(workspace.sync.password)
  );

  /**
   * Fetch the attachments for a given submission and store in Mongo if needed.
   * @param {Object} submission
   * @returns {boolean} True if updated submission.
   */
  const syncSubmissionAttachments = async function (workspace, source, project, form, submission) {
    if (
      submission._attachmentsPresent &&
      (!submission.attachments || submission.attachments.length < submission._attachmentsPresent)
    ) {
      let files = await odkClient.listSubmissionAttachments(project, form, submission.originId);

      let attachments = [];
      for (file of files) {
        let attachment = await uploader.getAttachment(
          workspace.name,
          source,
          submission._id,
          file.name
        );

        if (!attachment) {
          let odkAttachment = await odkClient.getAttachment(
            project,
            form,
            submission.originId,
            file.name
          );
          if (!odkAttachment) {
            throw new Error(`ODK attachment not found ${file.name}`);
          }

          attachment = await uploader.uploadAttachment(
            workspace.name,
            source,
            submission._id,
            file.name,
            odkAttachment.size,
            odkAttachment.file
          );
        }
        attachments.push(attachment);
      }

      if (attachments.length) {
        submission = await sourceManager.addSubmissionAttachments(submission._id, attachments);
        return true;
      }
    }

    return false;
  };

  let sources = (await sourceManager.listSources({ limit: -1 })).results;

  for (let source of sources) {
    try {
      let [project, form] = source.namespace.split('-');
      project = project.trim();
      form = form.trim();

      let submissions = await sourceManager.getSubmissionsNeedingAttachmentSync(source);
      debug(`Submissions to sync [${source.name}] attachments: ${submissions.length}`);
      let synced = [];
      while (submissions.length) {
        const submission = submissions.shift();
        try {
          let updated = await syncSubmissionAttachments(
            workspace,
            source,
            project,
            form,
            submission
          );
          if (updated) {
            synced.push(submission._id.toString());
          }
        } catch (error) {
          debug(
            `Failed to sync attachments for ${submission._id} ` +
              `[Project: ${project}] [Form: ${form}] ` +
              `[Submission: ${submission.originId}]`,
            error.stack
          );
        }
      }

      debug('Updated', synced.length);
    } catch (error) {
      debug(`Failed to sync source ${source.name}`, error.stack);
    }
  }

  debug('odk-sync-attachments END', new Date());
};

