const SYSTEM_PARAMS = ['table', 'sort', 'order', 'offset', 'limit'];

const $data = document.getElementById('data');
const ORIGIN_TYPE = $data.dataset.type;
const ORIGIN_ID = $data.dataset.id;

const updateSubmission = function (id, field, value, currentValue, valueType) {
  const formData = new FormData();
  formData.append('id', id);
  formData.append('field', field);
  formData.append('value', value);
  formData.append('currentValue', currentValue);
  formData.append('valueType', valueType);

  formData.append('originType', ORIGIN_TYPE);
  formData.append('originId', ORIGIN_ID);

  return $api('/data-viewer/api/edit', {
    method: 'POST',
    body: formData
  }).then((response) => {
    let tds = $data.querySelectorAll(`table td[data-id="${id}"][data-field="${field}"]`);

    tds.forEach((td) => {
      td.innerHTML = response.html;

      if (response.isAttachment) {
        td.classList.remove('editable');
      } else {
        td.classList.add('editable');
        td.dataset.value = response.value !== null ? response.value : '';
      }
      let jsonSource = td.closest('tr').querySelector('.source-json');
      if (jsonSource) {
        jsonSource.innerText = response.submissionPretty;
      }
    });

    return response;
  });
};

const edit = function (event) {
  let td = event.target.closest('td');
  let curValue = td.dataset.value;
  editModal.editing = {
    id: td.dataset.id,
    field: td.dataset.field,
    value: curValue
  };

  editModal.$attachment.classList.add('d-none');
  editModal.$attachment.value = '';
  editModal.$input.classList.remove('d-none');
  editModal.$input.value = curValue || '';

  let type = 'text';
  // Is number?
  if (curValue && /^[\d\.]+$/.test(curValue)) {
    type = 'int';
    if (curValue.indexOf('.') > -1) {
      type = 'float';
    }
  }

  editModal.editing.type = type;

  let inputType = editModal.$el.querySelector('select');
  inputType.value = type;
  editModal.modal.show();
};

const undoStack = [];
const $undo = document.getElementById('undo');
if ($undo) {
  $undo.querySelector('button').addEventListener('click', () => {
    if (!undoStack.length) {
      return;
    }
    let toUndo = undoStack.pop();
    $undo.querySelector('button').setAttribute('disabled', 'disabled');
    updateSubmission(toUndo.id, toUndo.field, toUndo.value, toUndo.currentValue, toUndo.type)
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
  let inputType = editModal.$el.querySelector('select').value;
  editModal.$save.setAttribute('disabled', 'disabled');

  let newValue = input.value.trim();
  let error = null;

  if (inputType === 'attachment') {
    if (editModal.$attachment.files.length === 1) {
      newValue = editModal.$attachment.files[0];
    } else {
      error = 'File required';
    }
  } else if (inputType === 'int') {
    if (!newValue) {
      newValue = 0;
    }

    newValue = parseInt(newValue);
    if (isNaN(newValue)) {
      error = 'Invalid number';
    }
  } else if (inputType === 'float') {
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
    if (inputType !== 'attachment') {
      input.select();
    }
    alert(error);
    return;
  }

  editModal.$save.previousElementSibling.classList.remove('d-none');
  updateSubmission(
    editModal.editing.id,
    editModal.editing.field,
    newValue,
    editModal.editing.value,
    inputType
  )
    .then((response) => {
      if (inputType !== 'attachment') {
        pushUndo({ ...editModal.editing, currentValue: newValue });
      }

      editModal.modal.hide();
    })
    .catch((error) => {
      alert(error && error.message ? error.message : error);
      if (inputType !== 'attachment') {
        input.select();
      }
    })
    .finally(() => {
      editModal.$save.removeAttribute('disabled');
      editModal.$save.previousElementSibling.classList.add('d-none');
    });
};

let el = document.getElementById('edit-modal');
const editModal = {
  $el: el,
  $input: document.getElementById('edit-input'),
  $attachment: document.getElementById('attachment-input'),
  $type: el.querySelector('select'),
  $save: el.querySelector('.btn-primary')
};

editModal.modal = new bootstrap.Modal(editModal.$el, {
  // keyboard: false
  focus: false
});
editModal.$el.addEventListener('shown.bs.modal', (event) => {
  editModal.$input.select();
});
editModal.$save.addEventListener('click', saveEdit);
editModal.$input.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    saveEdit();
  }
});
editModal.$type.addEventListener('change', (event) => {
  if (event.target.value === 'attachment') {
    editModal.$attachment.classList.remove('d-none');
    editModal.$input.classList.add('d-none');
  } else {
    editModal.$attachment.classList.add('d-none');
    editModal.$input.classList.remove('d-none');
    editModal.$input.select();
  }
});

$data.addEventListener('dblclick', function (event) {
  let td = event.target.closest('td.editable');
  if (td) {
    edit(event);
  }
});

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
  renameFieldModal.modal = new bootstrap.Modal(renameFieldModal.$el, {
    // keyboard: false
    focus: false
  });
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

  document.getElementById('btn-delete-import').addEventListener('click', (event) => {
    let $btn = event.target;
    if (confirm('Are you sure you want to delete this staged import?')) {
      $btn.setAttribute('disabled', 'disabled');

      let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
        window.location.pathname
      );
      $api(`/api/source/${sourceId}/import/${importId}`, {
        method: 'DELETE'
      })
        .then(() => {
          window.location.href = `/data-viewer/source/${sourceId}/import`;
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
          $btn.removeAttribute('disabled');
        });
    }
  });

  document.getElementById('btn-import-records').addEventListener('click', (event) => {
    if (confirm('Are you sure you want to import all the records?')) {
      let $btn = event.target;
      $btn.setAttribute('disabled', 'disabled');
      let [match, sourceId, importId] = /\/source\/([^\/]+)\/import\/([^\/]+)/i.exec(
        window.location.pathname
      );
      $api(`/api/source/${sourceId}/import/${importId}`, {
        method: 'POST'
      })
        .then(() => {
          window.location.href = `/data-viewer/source/${sourceId}/import`;
        })
        .catch((error) => {
          alert(error && error.message ? error.message : error);
          $btn.removeAttribute('disabled');
        });
    }
  });
}

// FILTERS

let currentFilters = {};
let queryWithoutFilters = null;
const allFilters = Array.from($data.querySelectorAll('.table thead th')).reduce(
  (map, el) => {
    if (el.dataset.field) {
      map[el.dataset.field] = el.dataset.name;
    }
    return map;
  },
  // Allow an ID filter param
  { id: 'ID' }
);

const filters = {
  $dropdownBtn: document.querySelector('.dropdown.filters'),
  $dropdown: document.querySelector('.dropdown-menu.filters'),
  $activeFilters: document.getElementById('active-filters')
};

// Select new filter
filters.$dropdown.addEventListener('click', (event) => {
  let $item = event.target.closest('.add-filter');
  if ($item) {
    let filter = $item.dataset.id;
    currentFilters[filter] = currentFilters[filter] || [];
    addFilter(filter);
  }
});

filters.$activeFilters.addEventListener('click', (event) => {
  let $btn = event.target.closest('.btn.remove-filter');
  if ($btn) {
    let filter = $btn.dataset.id;
    let index = $btn.dataset.index;
    currentFilters[filter].splice(index, 1);
    addFilter(filter);
    fetchFilters();
  }
});

filters.$activeFilters.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') {
    let $input = event.target.closest('.filter-input');
    if ($input) {
      let filter = $input.dataset.id;
      currentFilters[filter] = currentFilters[filter] || [];
      let value = $input.value.trim();
      if (value) {
        currentFilters[filter].push(value);
        addFilter(filter);
        fetchFilters();
      }
    }
    return;
  }

  if (event.key === 'Backspace') {
    let $input = event.target.closest('.filter-input');
    if ($input) {
      let filter = $input.dataset.id;
      currentFilters[filter] = currentFilters[filter] || [];
      if (currentFilters[filter].length > 0) {
        currentFilters[filter].splice(currentFilters[filter].length - 1, 1);
        addFilter(filter);
        fetchFilters();
      }
    }
  }
});

const addFilter = function (filter) {
  let html = Object.keys(currentFilters).reduce((html, key) => {
    let values = currentFilters[key];
    let heading = `<strong class="my-0">${allFilters[key]}:</strong>`;
    let buttons = values
      .map((value, index) => {
        return `<button
          type="button"
          class="btn btn-primary btn-sm ms-2 remove-filter"
          data-id="${key}"
          data-index="${index}"
          data-value="${value.replace(/"/g, '"')}"
          title="Remove filter">${value} <span class="ms-2" >&times;</span></button>`;
      })
      .join(' ');

    let input = `<input
        type="text"
        data-id="${key}"
        placeholder="${values.length ? 'or... ' : 'value'}"
        class="filter-input px-2 ms-2" />`;

    return (
      html +
      '<div class="d-flex align-items-center mb-2 mt-2">' +
      heading +
      buttons +
      input +
      '</div>'
    );
  }, '');
  filters.$activeFilters.innerHTML = html;

  if (filter) {
    let inputs = filters.$activeFilters.querySelectorAll(`input[data-id="${filter}"`);
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
    }
  }

  resize();
};

const initFilter = function (filter) {
  let params = new URLSearchParams(window.location.search);
  let filters = {};
  Array.from(params.keys())
    .filter((key) => {
      if (SYSTEM_PARAMS.includes(key)) {
        return false;
      }

      return Object.keys(allFilters).includes(key);
    })
    .forEach((key) => {
      let values = params.getAll(key).filter(Boolean);
      if (values.length) {
        filters[key] = values;
      }
      params.delete(key);
    });
  currentFilters = filters;
  params.delete('offset');
  queryWithoutFilters = params.toString();
  addFilter();
};

const fetchFilters = function () {
  let params = new URLSearchParams();

  Object.keys(currentFilters).forEach((filter) => {
    currentFilters[filter].filter(Boolean).forEach((v) => {
      params.append(filter, v);
    });
  });

  const url = queryWithoutFilters
    ? '?' + queryWithoutFilters + '&' + params.toString()
    : '?' + params.toString();
  fetch(window.location.pathname + url + '&xhr=1')
    .then((response) => {
      return response.text();
    })
    .then((text) => {
      if (url !== window.location.search) {
        window.history.pushState(null, window.location.title, url);
      }

      $data.innerHTML = text;
      updateExportLinks(getFormPrefs().hiddenFields);
    })
    .catch((error) => {
      let msg = error && error.message ? error.message : error;
      let errorEl = document.getElementById('page-error');
      errorEl.classList.remove('d-none');
      errorEl.innerText = msg;
    });
};

function hideFields(hiddenFields) {
  const main = document.body.querySelector('main');
  let styleTag = document.getElementById('field-visibility-styles');
  if (styleTag) {
    styleTag.parentNode.removeChild(styleTag);
  }

  if (hiddenFields && hiddenFields.length) {
    let css = hiddenFields.reduce((str, field) => {
      return (
        str +
        `
        #data > table [data-field="${field}"] {
          display: none;
        }`
      );
    }, '');

    styleTag = document.createElement('style');
    styleTag.id = 'field-visibility-styles';
    styleTag.textContent = css;
    main.prepend(styleTag);
  }
}

function initBootstrap() {
  // Init Bootstrap popovers
  document.querySelectorAll('[data-bs-toggle="popover"]').forEach((popoverTriggerEl) => {
    return new bootstrap.Popover(popoverTriggerEl);
  });
}

const updateExportLinks = (hidden) => {
  document.querySelectorAll('#data .export-btn').forEach(($a) => {
    let href = $a.href.replace(/&hidden=[^&]+/i, '');
    if (hidden && hidden.length) {
      $a.href = href + '&hidden=' + encodeURIComponent(hidden.join(','));
    } else {
      $a.href = href;
    }
  });
};

function initFieldToggles(initHiddenFields) {
  const fieldTogglesBtn = document.getElementById('field-toggles');
  const fieldToggles = fieldTogglesBtn.nextElementSibling;
  const allFieldsCount = parseInt(fieldTogglesBtn.querySelector('.all-count').innerText.trim());

  fieldTogglesBtn.addEventListener('hide.bs.dropdown', () => {
    let hidden = Array.from(
      fieldToggles.querySelectorAll('input[type=checkbox]:not(:checked)')
    ).map((el) => {
      return el.value;
    });

    hideFields(hidden);
    fieldTogglesBtn.querySelector('.visible-count').innerText = allFieldsCount - hidden.length;
    updateExportLinks(hidden);
    setFormPref('hiddenFields', hidden);
  });

  fieldToggles.querySelector('.btn.select-all').addEventListener('click', () => {
    fieldToggles.querySelectorAll('input[type=checkbox]').forEach((el) => {
      el.checked = true;
    });
  });
  fieldToggles.querySelector('.btn.select-none').addEventListener('click', () => {
    fieldToggles.querySelectorAll('input[type=checkbox]').forEach((el) => {
      el.checked = false;
    });
  });

  if (initHiddenFields) {
    hideFields(initHiddenFields);
    updateExportLinks(initHiddenFields);
    fieldTogglesBtn.querySelector('.visible-count').innerText =
      allFieldsCount - initHiddenFields.length;
    fieldToggles.querySelectorAll('input[type=checkbox]').forEach((el) => {
      if (initHiddenFields.includes(el.value)) {
        el.checked = false;
      }
    });
  }
}

function getFormPrefs() {
  try {
    let prefJson = window.localStorage.getItem(`pref-${ORIGIN_TYPE}-${ORIGIN_ID}`);
    if (prefJson) {
      return JSON.parse(prefJson);
    }
  } catch (e) {
    // Silence json/storage errors
  }

  return {};
}

function setFormPref(field, value) {
  let prefs = getFormPrefs();
  prefs[field] = value;
  try {
    window.localStorage.setItem(`pref-${ORIGIN_TYPE}-${ORIGIN_ID}`, JSON.stringify(prefs));
  } catch (e) {
    // Silence json/storage errors
  }

  return prefs;
}

function onLoad() {
  initFilter();
  initBootstrap();
  let prefs = getFormPrefs();
  initFieldToggles(prefs.hiddenFields);
  document.getElementById('data-loader').classList.add('d-none');
  getFormPrefs();
  window.addEventListener('resize', resize);
}

function resize() {
  let headerRect = document.body.querySelector('main > header').getBoundingClientRect();
  $data.style.height = window.innerHeight - (headerRect.top + headerRect.height) + 'px';
}

// Global attachment image error handler.
window.onAttachmentPreviewError = function (img) {
  let modal = img.parentElement.closest('.modal-content');
  if (modal) {
    modal.querySelectorAll('.rotate-btn').forEach((el) => {
      el.setAttribute('disabled', 'disabled');
    });
  }
  img.parentElement.innerText = 'No preview available';
};

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

  let deleteAttachmentBtn = event.target.closest('.delete-attachment');
  if (deleteAttachmentBtn && confirm('Are you sure you want to delete this file?')) {
    updateSubmission(
      deleteAttachmentBtn.dataset.submissionId,
      deleteAttachmentBtn.dataset.fieldName,
      '',
      deleteAttachmentBtn.dataset.name
    ).then(() => {
      // Remove attachment backdrop remnants.
      document.body.classList.remove('modal-open');
      document.body.style = '';
      let backdrop = document.querySelector('body > .modal-backdrop.show');
      if (backdrop) {
        document.body.removeChild(backdrop);
      }
    });
  }
});

onLoad();

