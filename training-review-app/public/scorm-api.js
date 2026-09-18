/**
 * A permissive, browser-side SCORM 1.2 / SCORM 2004 "LMS" API shim.
 *
 * SCORM content looks for a JS object named `API` (1.2) or `API_1484_11`
 * (2004) by walking up window.parent / window.opener from wherever it's
 * running. Because this app loads the module in a same-origin iframe
 * inside this page, defining those objects on `window` here is enough for
 * the content to find them -- no postMessage bridging needed.
 *
 * It doesn't implement real sequencing or grading; it just accepts
 * whatever the content reports (bookmark/location, progress, score) so the
 * content runs the way it would in a real LMS, and surfaces the current
 * location/page so the review UI can auto-tag new comments with it.
 */
(function (global) {
  'use strict';

  function createScormShim({ learnerId, learnerName } = {}) {
    const data = new Map();
    const listeners = new Set();
    let currentLocation = '';
    let initialized = false;

    function setDefault(key, value) {
      if (!data.has(key)) data.set(key, value);
    }

    function resetModel() {
      data.clear();
      setDefault('cmi.core.student_id', learnerId || '');
      setDefault('cmi.core.student_name', learnerName || '');
      setDefault('cmi.core.lesson_location', '');
      setDefault('cmi.core.lesson_status', 'incomplete');
      setDefault('cmi.core.credit', 'credit');
      setDefault('cmi.core.entry', 'ab-initio');
      setDefault('cmi.core.total_time', '0000:00:00.00');
      setDefault('cmi.core.score.raw', '');
      setDefault('cmi.core.score.min', '');
      setDefault('cmi.core.score.max', '100');
      setDefault('cmi.suspend_data', '');
      setDefault('cmi.launch_data', '');

      setDefault('cmi.learner_id', learnerId || '');
      setDefault('cmi.learner_name', learnerName || '');
      setDefault('cmi.location', '');
      setDefault('cmi.completion_status', 'incomplete');
      setDefault('cmi.success_status', 'unknown');
      setDefault('cmi.credit', 'credit');
      setDefault('cmi.entry', 'ab-initio');
      setDefault('cmi.total_time', 'PT0H0M0S');
      setDefault('cmi.score.raw', '');
      setDefault('cmi.score.min', '');
      setDefault('cmi.score.max', '100');
      setDefault('cmi.score.scaled', '');
      setDefault('cmi.suspend_data', '');
      setDefault('cmi.mode', 'normal');

      currentLocation = '';
      initialized = false;
    }
    resetModel();

    function notifyLocation(loc) {
      currentLocation = loc;
      for (const fn of listeners) {
        try { fn(loc); } catch (e) { /* listener errors shouldn't break the API */ }
      }
    }

    function setValue(key, value) {
      data.set(key, String(value));
      if (key === 'cmi.core.lesson_location' || key === 'cmi.location') {
        notifyLocation(String(value));
      }
      return 'true';
    }

    function getValue(key) {
      return data.has(key) ? data.get(key) : '';
    }

    // ---- SCORM 1.2 ----
    const api12 = {
      LMSInitialize() { initialized = true; return 'true'; },
      LMSFinish() { initialized = false; return 'true'; },
      LMSGetValue(key) { return getValue(key); },
      LMSSetValue(key, value) { return setValue(key, value); },
      LMSCommit() { return 'true'; },
      LMSGetLastError() { return '0'; },
      LMSGetErrorString() { return 'No error'; },
      LMSGetDiagnostic() { return ''; }
    };

    // ---- SCORM 2004 ----
    const api2004 = {
      Initialize() { initialized = true; return 'true'; },
      Terminate() { initialized = false; return 'true'; },
      GetValue(key) { return getValue(key); },
      SetValue(key, value) { return setValue(key, value); },
      Commit() { return 'true'; },
      GetLastError() { return '0'; },
      GetErrorString() { return 'No error'; },
      GetDiagnostic() { return ''; }
    };

    return {
      api12,
      api2004,
      getCurrentLocation: () => currentLocation,
      onLocationChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      reset: resetModel,
      install(targetWindow) {
        targetWindow.API = api12;
        targetWindow.API_1484_11 = api2004;
      },
      uninstall(targetWindow) {
        try { delete targetWindow.API; } catch (e) { targetWindow.API = undefined; }
        try { delete targetWindow.API_1484_11; } catch (e) { targetWindow.API_1484_11 = undefined; }
      }
    };
  }

  global.ScormShim = { create: createScormShim };
})(window);
