const $data = document.getElementById('data');
const ORIGIN_TYPE = window._ORIGIN_TYPE;
const ORIGIN_ID = window._ORIGIN_ID;
const ORIGIN_NAME = window._ORIGIN_NAME;
const IS_IFRAME_FIELD = window._IS_IFRAME_FIELD;
const IS_IFRAME = !!IS_IFRAME_FIELD && !!window.parent;
const FIELD_TYPES = {
  ATTACHMENT: 'attachment',
  FLOAT: 'float',
  INT: 'int',
  LOOKUP: 'lookup',
  SEQUENCE: 'sequence',
  TEXT: 'text'
};
let DBL_CLICK_TIMER = null;
let DATA_MODE = 'list';

const focusOnDataTable = function () {
  // Focus on first row so keyboard works well with up/down.
  document.querySelector('tbody tr').focus();
};

const INITIAL_PAGE_PARAMS = new URLSearchParams(window.location.search);

/**
 * Broadcast message to parent window.
 * @param {string} action Name of action to post.
 * @param {*} value Data to push.
 */
const postParentMessage = function (action, value = null) {
  if (window && window.parent) {
    window.parent.postMessage({
      action,
      value
    });
  }
};

const updateSubmission = function (target, field, value, currentValue, valueType) {
  const formData = new FormData();

  if (target.fields && target.fields.length) {
    formData.append('fields', JSON.stringify(target.fields));
  } else if (target.ids && target.ids.length) {
    formData.append('ids', target.ids);
    formData.append('field', field);
  } else if (target.filter) {
    formData.append('filter', target.filter);
    formData.append('field', field);
  }

  formData.append('currentValue', currentValue);
  formData.append('value', value);
  if (valueType) {
    formData.append('valueType', valueType);
  }

  formData.append('originType', ORIGIN_TYPE);
  formData.append('originId', ORIGIN_ID);

  let url = `/data-viewer/api/edit/${ORIGIN_TYPE}`;
  let isAttachment = false;
  if (value instanceof File) {
    isAttachment = true;
    url = '/data-viewer/api/edit/attachment';
  }

  // TODO Look to bring back if people don't like updated cells persisting until page refresh.
  // Remove prior updated visual queues prior to saving new updates.
  // $data.querySelectorAll('td.updated').forEach(($td) => {
  //   $td.classList.remove('updated');
  // });

  return $api(url, {
    method: 'POST',
    body: formData
  }).then((response) => {
    if (target.ids) {
      let trs = [...$data.querySelectorAll('table tr')].filter(($tr) =>
        target.ids.includes($tr.dataset.id)
      );

      trs.forEach(($tr) => {
        let $td = $tr.querySelector(`td[data-field="${field}"]`);
        if ($td) {
          if (isAttachment) {
            $td.classList.remove('editable');
          } else {
            $td.classList.add('editable');
          }
          $td.classList.add('updated');
          $td.dataset.value = response.value !== null ? response.value : '';
          $td.innerHTML = response.html;
        }
      });
    } else if (target.fields) {
      target.fields.forEach((f) => {
        let id = f.id,
          subIndex,
          match;
        if (/\[\d+\]$/.test(f.id)) {
          // Extract ID out of view exploded id string: 65da0191fe898c4f53dec740[0]
          [match, id, subIndex] = id.match(/^([^\[]+)\[(\d+)\]$/);
          subIndex = parseInt(subIndex);
        }

        let tds = $data.querySelectorAll(`tr[data-id="${id}"] > td[data-field="${f.field}"]`);
        tds.forEach(($td) => {
          $td.classList.add('editable');
          $td.classList.add('updated');
          $td.dataset.value = response.value !== null ? response.value : '';
          if (response.htmls && response.htmls[`${id}-${f.field}`]) {
            $td.innerHTML = response.htmls[`${id}-${f.field}`];
          } else {
            $td.innerHTML = response.html;
          }
        });
      });
    }

    return response;
  });
};

// #######################################################
// # EDITING & UNDO STACK
// #######################################################

const undoStack = [];
const $undo = document.getElementById('undo');
if ($undo) {
  $undo.querySelector('button').addEventListener('click', () => {
    if (!undoStack.length) {
      return;
    }
    let toUndo = undoStack.pop();
    $undo.querySelector('button').setAttribute('disabled', 'disabled');
    updateSubmission(toUndo.target, toUndo.field, toUndo.value, toUndo.currentValue, toUndo.type)
      .catch((error) => {
        alert(error && error.message ? error.message : error);
      })
      .finally(() => {
        if (undoStack.length) {
          $undo.querySelector('button').removeAttribute('disabled', 'disabled');
        }
      });
  });
}

const pushUndo = function (item) {
  undoStack.push(item);
  if ($undo) {
    $undo.querySelector('button').removeAttribute('disabled');
  }
};

const saveEdit = function () {
  let input = editModal.$input;
  let inputType = editModal.$type.value;
  editModal.$save.setAttribute('disabled', 'disabled');

  let newValue = input.value.trim();
  let error = null;

  if (inputType === FIELD_TYPES.ATTACHMENT) {
    if (editModal.$attachment.files.length === 1) {
      newValue = editModal.$attachment.files[0];
    } else {
      error = 'File required';
    }
  } else if (inputType === FIELD_TYPES.INT) {
    if (!newValue) {
      newValue = 0;
    }

    newValue = parseInt(newValue);
    if (isNaN(newValue)) {
      error = 'Invalid number';
    }
  } else if (inputType === FIELD_TYPES.FLOAT) {
    if (!newValue) {
      newValue = 0;
    }
    newValue = parseFloat(newValue);
    if (isNaN(newValue)) {
      error = 'Invalid number';
    }
  }

  if (error) {
    editModal.$save.removeAttribute('disabled');
    editModal.$el.querySelector('.btn-close').removeAttribute('disabled');
    if (inputType !== FIELD_TYPES.ATTACHMENT) {
      input.select();
    }
    alert(error);
    return;
  }

  editModal.$save.previousElementSibling.classList.remove('d-none');
  editModal.$el.querySelector('.btn-close').setAttribute('disabled', 'disabled');

  updateSubmission(
    editModal.editing.target,
    editModal.editing.field,
    newValue,
    editModal.editing.value,
    inputType
  )
    .then((response) => {
      if (inputType !== FIELD_TYPES.ATTACHMENT) {
        pushUndo({ ...editModal.editing, currentValue: newValue });
      }

      if (editModal.onClose) {
        // Trigger modal on close, indicating a save ocurred.
        editModal.onClose(true);
        // Prevent double call of onClose
        editModal.onClose = null;
      }

      editModal.modal.hide();
    })
    .catch((error) => {
      console.error(error);
      alert(error && error.message ? error.message : error);
      if (inputType !== FIELD_TYPES.ATTACHMENT) {
        input.select();
      }
    })
    .finally(() => {
      editModal.$save.removeAttribute('disabled');
      editModal.$el.querySelector('.btn-close').removeAttribute('disabled');
      editModal.$save.previousElementSibling.classList.add('d-none');
    });
};

let el = document.getElementById('edit-modal');
const editModal = {
  $el: el,
  $input: document.getElementById('edit-input'),
  $attachment: document.getElementById('attachment-input'),
  $lookup: el.querySelector('.lookup-container'),
  $bulkWarning: document.getElementById('edit-count-warning'),
  $type: el.querySelector('select'),
  $save: el.querySelector('.btn.save'),
  $clear: el.querySelector('.btn.clear'),
  getEditTarget: (td) => {
    let target = {};

    // Views need to update individual fields on unique submissions
    if (ORIGIN_TYPE === 'view' && td) {
      let tdIndex = [...td.parentNode.children].indexOf(td);
      let fields = {};
      $data.querySelectorAll('.submission-check:checked').forEach(($check) => {
        let id = $check.dataset.id;
        let field = $check.closest('tr').children[tdIndex].dataset.field;
        fields[`${id}${field}`] = { id, field };
      });
      target.fields = Object.values(fields);
    } else {
      // Sources can edit a lot of stuff in bulk
      let ids = [];
      $data.querySelectorAll('.submission-check:checked').forEach((el) => {
        ids.push(el.dataset.id);
      });

      if (ids.length) {
        target.ids = ids;
      }
    }

    return target;
  }
};

editModal.modal = new bootstrap.Modal(editModal.$el);
editModal.$el.addEventListener('shown.bs.modal', (event) => {
  if (editModal.$type.value === FIELD_TYPES.LOOKUP) {
    let iframe = editModal.$lookup.querySelector('iframe');
    if (iframe) {
      let filterInput = iframe.contentDocument.querySelector('#active-filters input');
      if (filterInput) {
        filterInput.select();
      }
    }
  } else {
    editModal.$input.select();
  }
});
editModal.$el.addEventListener('hide.bs.modal', (event) => {
  editModal.$el.querySelector('.btn-close').removeAttribute('disabled');
  if (editModal.onClose) {
    editModal.onClose();
  }
});
editModal.$save.addEventListener('click', saveEdit);
editModal.$clear.addEventListener('click', (event) => {
  editModal.$input.value = '';
});
editModal.$input.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    saveEdit();
  }
});
editModal.$type.addEventListener('change', (event) => {
  let $dialog = editModal.$el.querySelector('.modal-dialog');
  if (event.target.value === FIELD_TYPES.LOOKUP) {
    editModal.$lookup.classList.remove('d-none');
    $dialog.querySelector('.modal-title').innerText = 'Select';
  } else {
    editModal.$lookup.classList.add('d-none');
    $dialog.querySelector('.modal-title').innerText = 'Edit Submission';
  }

  if (event.target.value === FIELD_TYPES.ATTACHMENT) {
    editModal.$attachment.classList.remove('d-none');
    editModal.$input.classList.add('d-none');
  } else if (event.target.value === FIELD_TYPES.SEQUENCE) {
    editModal.$input.setAttribute('disabled', 'disabled');
  } else if (event.target.value === FIELD_TYPES.LOOKUP) {
  } else {
    editModal.$attachment.classList.add('d-none');
    editModal.$input.classList.remove('d-none');
    editModal.$input.removeAttribute('disabled');
    editModal.$input.select();
  }
});

if (IS_IFRAME) {
  const IFRAME_ACTION = window.frameElement.dataset.action || 'select';
  $data.setAttribute('data-iframe-action', IFRAME_ACTION);

  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape') {
      postParentMessage('cancel');
    }
  });

  if (IFRAME_ACTION === 'select') {
    $data.addEventListener('dblclick', function (event) {
      clearTimeout(DBL_CLICK_TIMER);
      let $tr = event.target.closest('tr');
      if ($tr) {
        postParentMessage('save');
      }
    });

    $data.addEventListener('click', function (event) {
      let $tr = event.target.closest('tr');
      if ($tr && $tr.dataset.id) {
        let $checkbox = $tr.querySelector('.submission-check');
        $checkbox.checked = true;
        let $td = $tr.querySelector(`td[data-field="${IS_IFRAME_FIELD}"]`);
        let value = $td ? $td.dataset.value : $tr.dataset.id;

        // Is number?
        if (value && /^[\d\.]+$/.test(value)) {
          if (value.indexOf('.') > -1) {
            value = parseFloat(value);
          } else {
            value = parseInt(value);
          }

          if (isNaN(value)) {
            value = '';
          }
        }

        postParentMessage('set-lookup-value', value);
      }
    });
  }
} else {
  $data.addEventListener('dblclick', function (event) {
    clearTimeout(DBL_CLICK_TIMER);
    let td = event.target.closest('td.editable');
    if (td) {
      let curValue = td.dataset.value;

      // Ensure current row is checked
      let wasChecked = false;
      let $checkbox = td.closest('tr').querySelector('.submission-check');
      if (!$checkbox.checked) {
        $checkbox.checked = true;
        wasChecked = true;
      }

      let target = editModal.getEditTarget(td);
      let checkedCount = $data.querySelectorAll('.submission-check:checked').length;

      editModal.onClose = (saved = false) => {
        // On save, only one, clear
        // On cancel, only one, clear
        // On cancel, multiple, clear target if it wasn't originally checked
        if (checkedCount === 1) {
          $checkbox.checked = false;
        } else if (!saved && wasChecked) {
          $checkbox.checked = false;
        }
      };

      editModal.editing = {
        target: target,
        field: td.dataset.field,
        value: curValue
      };

      editModal.$attachment.classList.add('d-none');
      editModal.$attachment.value = '';
      editModal.$input.classList.remove('d-none');
      editModal.$input.value = curValue || '';

      let type = FIELD_TYPES.TEXT;
      if (td.dataset.type) {
        if (/source|view/.test(td.dataset.type)) {
          type = FIELD_TYPES.LOOKUP;
        } else {
          type = td.dataset.type;
        }
      } else {
        // Is number?
        if (curValue && /^[\d\.]+$/.test(curValue)) {
          type = FIELD_TYPES.INT;
          if (curValue.indexOf('.') > -1) {
            type = FIELD_TYPES.FLOAT;
          }
        }
      }

      editModal.editing.type = type;
      editModal.$type.value = type;
      editModal.$type
        .querySelector(`option[value="${FIELD_TYPES.SEQUENCE}"]`)
        .setAttribute('disabled', 'disabled');
      editModal.$type
        .querySelector(`option[value="${FIELD_TYPES.LOOKUP}"]`)
        .setAttribute('disabled', 'disabled');

      let $dialog = editModal.$el.querySelector('.modal-dialog');
      if (type === FIELD_TYPES.LOOKUP) {
        editModal.$input.setAttribute('disabled', 'disabled');
        // editModal.$type.setAttribute('disabled', 'disabled');
        let originType = td.dataset.type;
        let originId = td.dataset.typeOrigin;
        let originField = td.dataset.typeOriginField;
        let $iframe = document.createElement('iframe');
        $iframe.dataset.action = 'select';
        $iframe.classList.add('lookup');
        let filter = curValue ? encodeURIComponent(`"${curValue}"`) : '';
        $iframe.setAttribute(
          'src',
          `/data-viewer/${originType}/${originId}?iframe=${encodeURIComponent(
            originField
          )}&${encodeURIComponent(originField)}=${filter}`
        );
        editModal.$lookup.replaceChildren($iframe);
        editModal.$lookup.classList.remove('d-none');
        $dialog.classList.remove('modal-lg');
        $dialog.classList.add('modal-fullscreen');
        $dialog.querySelector('.modal-title').innerText = 'Select';
        editModal.$type
          .querySelector(`option[value="${FIELD_TYPES.LOOKUP}"]`)
          .removeAttribute('disabled', 'disabled');
      } else {
        if (type === FIELD_TYPES.SEQUENCE) {
          editModal.$input.setAttribute('disabled', 'disabled');
          editModal.$type
            .querySelector(`option[value="${FIELD_TYPES.SEQUENCE}"]`)
            .removeAttribute('disabled');
        } else {
          editModal.$input.removeAttribute('disabled');
        }

        editModal.$type.removeAttribute('disabled');
        editModal.$lookup.innerHTML = '';
        $dialog.classList.remove('modal-fullscreen');
        $dialog.classList.add('modal-lg');
        $dialog.querySelector('.modal-title').innerText = 'Edit Submission';
      }

      if (checkedCount > 1) {
        const numberFormatter = new Intl.NumberFormat();
        editModal.$bulkWarning.querySelector('span').innerText =
          numberFormatter.format(checkedCount);
        editModal.$bulkWarning.classList.remove('d-none');
      } else {
        editModal.$bulkWarning.classList.add('d-none');
      }

      editModal.modal.show();
    }
  });

  window.addEventListener(
    'message',
    (event) => {
      if (event.origin !== window.location.origin || !event.data) {
        return;
      }

      if (event.data?.action === 'set-lookup-value') {
        let value = event.data.value;
        editModal.$input.value = value;
        if (typeof value === 'number') {
          if (Number.isInteger(value)) {
            editModal.$type.value = FIELD_TYPES.INT;
          } else {
            editModal.$type.value = FIELD_TYPES.FLOAT;
          }
        }
      } else if (event.data?.action === 'save') {
        saveEdit();
      } else if (event.data?.action == 'cancel') {
        editModal.modal.hide();
        focusOnDataTable();
      }
    },
    false
  );
}

// #######################################################
// # VIEW ONLY LOGIC
// #######################################################

// Views can have multi-column edit effect
if (ORIGIN_TYPE === 'view') {
  $data.addEventListener('mouseover', function (event) {
    $data.querySelectorAll('.multi-active').forEach((el) => {
      el.classList.remove('multi-active');
    });
    let td = event.target.closest('td.editable');
    if (td && td.dataset.sourceField) {
      let id = td.closest('tr').dataset.id;
      let sameFieldEls = $data.querySelectorAll(
        `td[data-id="${id}"][data-field="${td.dataset.field}"]`
      );
      if (sameFieldEls.length > 1) {
        sameFieldEls.forEach((el) => {
          el.classList.add('multi-active');
        });
      }
    }
  });
}

// #######################################################
// # SOURCE IMPORT ONLY LOGIC
// #######################################################

if (ORIGIN_TYPE === 'import') {
  let renameFieldModalEl = document.getElementById('rename-field-modal');
  let renameFieldModal = {
    $el: renameFieldModalEl,
    $save: renameFieldModalEl.querySelector('button.save'),
    $input: renameFieldModalEl.querySelector('input[type=text]'),
    $hidden: renameFieldModalEl.querySelector('input[type=hidden]')
  };

  const renameField = function () {
    renameFieldModal.$input.classList.remove('is-invalid');

    let newName = renameFieldModal.$input.value.trim();
    let existingName = renameFieldModal.$hidden.value;
    if (newName && newName !== existingName) {
      renameFieldModal.$input.setAttribute('disabled', 'disabled');
      renameFieldModal.$save.setAttribute('disabled', 'disabled');

      let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
        window.location.pathname
      );
      $api(`/api/source/${sourceId}/import/${importId}/rename`, {
        method: 'PUT',
        body: JSON.stringify({
          id: existingName,
          name: newName
        })
      })
        .then(() => {
          window.location.reload();
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
          renameFieldModal.$input.removeAttribute('disabled');
          renameFieldModal.$save.removeAttribute('disabled');
        });
    } else {
      renameFieldModal.$input.classList.add('is-invalid');
    }
  };

  renameFieldModal = {
    $el: renameFieldModalEl,
    $save: renameFieldModalEl.querySelector('button.save'),
    $input: renameFieldModalEl.querySelector('input[type=text]'),
    $hidden: renameFieldModalEl.querySelector('input[type=hidden]')
  };
  renameFieldModal.modal = new bootstrap.Modal(renameFieldModal.$el);
  renameFieldModal.$el.addEventListener('shown.bs.modal', (event) => {
    renameFieldModal.$input.select();
  });
  renameFieldModal.$save.addEventListener('click', renameField);
  renameFieldModal.$input.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') {
      renameField();
    }
  });

  $data.addEventListener('click', (event) => {
    let renameFieldBtn = event.target.closest('.rename-field');
    if (renameFieldBtn) {
      let th = renameFieldBtn.closest('th');
      renameFieldModal.$input.classList.remove('is-invalid');
      renameFieldModal.$input.value = th.dataset.field;
      renameFieldModal.$hidden.value = th.dataset.field;
      renameFieldModal.modal.show();
    }
  });
}

// #######################################################
// # ATTACHMENT MODAL LOGIC
// #######################################################

document.addEventListener('click', (event) => {
  let rotateBtn = event.target.closest('.rotate-btn');
  if (rotateBtn) {
    let angle = 0;
    let diff = rotateBtn.classList.contains('counter-clockwise') ? -90 : 90;
    let img = rotateBtn.closest('.modal-dialog').querySelector('.modal-body img');
    let style = /rotate\((\d+)deg\)/i.exec(img.style.transform);
    if (style) {
      angle = parseInt(style[1]);
    }

    if (diff < 0 && angle === 0) {
      angle = 270;
    } else {
      angle = angle + diff;
    }
    img.style.transform = `rotate(${angle}deg)`;
  }

  let $deleteAttachmentBtn = event.target.closest('.delete-attachment');
  if ($deleteAttachmentBtn && confirm('Are you sure you want to delete this file?')) {
    let $td = $deleteAttachmentBtn.closest('td');
    let target = {
      ids: [$td.dataset.id]
    };
    if (ORIGIN_TYPE === 'view') {
      target = {
        fields: [{ id: $td.dataset.id, field: $td.dataset.field }]
      };
    }

    updateSubmission(target, $td.dataset.field, '', $deleteAttachmentBtn.dataset.name)
      .then(() => {
        // Remove attachment backdrop remnants.
        document.body.classList.remove('modal-open');
        document.body.style = '';
        let backdrop = document.querySelector('body > .modal-backdrop.show');
        if (backdrop) {
          document.body.removeChild(backdrop);
        }
      })
      .catch((error) => {
        console.error(error);
        alert(error && error.message ? error.message : error);
      });
  }
});

// Global attachment image error handler. Registered inline on images from _attachment.njk
window.onAttachmentPreviewError = function (img) {
  let modal = img.parentElement.closest('.modal-content');
  if (modal) {
    modal.querySelectorAll('.rotate-btn').forEach((el) => {
      el.setAttribute('disabled', 'disabled');
    });
  }
  img.parentElement.innerText = 'No preview available';
};

// #######################################################
// # LINKED DATA PREVIEW LOGIC
// #######################################################

const $lookupRefModal = document.getElementById('lookup-ref-modal');
const lookupRefModal = new bootstrap.Modal($lookupRefModal);
$data.addEventListener('click', (event) => {
  // If dbl click, ignore.
  if (event.detail === 2) {
    return;
  }

  let $td = event.target.closest('td');
  if ($td) {
    let $button = $td.querySelector('button');
    if ($button) {
      return;
    }

    let $a = event.target.closest('a');
    if ($a) {
      if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        // prevent normal click of link within field value.
        event.preventDefault();
      } else {
        return;
      }
    }

    // Make sure we have the link within the field value.
    $a = $td.querySelector('a');
    if ($a) {
      DBL_CLICK_TIMER = setTimeout(() => {
        let src = $a.getAttribute('href');
        let queryParams = src.indexOf('?') === -1 ? '?_select=false' : '&_select=false';
        queryParams += '&iframe=' + encodeURIComponent($td.dataset.field);
        let $iframe = document.createElement('iframe');
        $iframe.classList.add('lookup');
        $iframe.setAttribute('src', src + queryParams);
        $iframe.dataset.action = 'lookup';
        $lookupRefModal.querySelector('.lookup-container').replaceChildren($iframe);
        lookupRefModal.show();
      }, 200);
    }
  }
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || !event.data) {
    return;
  }

  if (event.data?.action == 'cancel') {
    lookupRefModal.hide();
    focusOnDataTable();
  }
});

// #######################################################
// # INIT
// #######################################################

function onLoad() {
  // Init Bootstrap popovers (help tips)
  document.querySelectorAll('[data-bs-toggle="popover"]').forEach((popoverTriggerEl) => {
    return new bootstrap.Popover(popoverTriggerEl);
  });

  if (IS_IFRAME) {
    postParentMessage('load', {
      id: ORIGIN_ID,
      name: ORIGIN_NAME,
      type: ORIGIN_TYPE
    });
  } else {
    focusOnDataTable();
  }

  document.getElementById('data-loader').classList.add('d-none');
  $data.dataset.loaded = true;
}

onLoad();

