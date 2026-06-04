/**
 * SAK-52363 – Lessons: Saving new content should focus on the added item
 *
 * After adding or editing a Lessons item and clicking Save, the page does a
 * full reload and scrolls back to the top.  This patch stores the target
 * item-id in sessionStorage just before the form is submitted, then—on the
 * next page load—reads that value, scrolls to the element, and cleans up.
 *
 * Integration: include / append this file after show-page.js, or merge the
 * two $(document).ready blocks into the existing one in show-page.js.
 *
 * Affected forms / save paths
 * ───────────────────────────
 * • Edit item dialog      → #edit-item          (submit button)
 * • Add multimedia dialog → #mm-add-item        (submit button)
 * • Edit multimedia       → #edit-multimedia-item
 * • Add text (inline CKEditor auto-saves via a hidden form)
 * • Subpage dialog        → #create-subpage
 * • Question dialog       → #update-question
 * • Comments dialog       → #update-comments
 * • Student content       → #update-student
 * • YouTube dialog        → #update-youtube
 * • Movie dialog          → #update-movie
 * • Checklist             → (links that call existing handlers)
 * • Announcements / Forum summary → their own submit buttons
 *
 * The item-id is read from the hidden <span class="current-item-id2"> that
 * Sakai already renders inside every item row, or from the hidden input that
 * each dialog populates before opening (#item-id, #mm-item-id, …).
 */

(function ($) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Constants                                                          */
    /* ------------------------------------------------------------------ */
    var STORAGE_KEY     = 'lessons.scrollToItemId';
    var HIGHLIGHT_CLASS = 'lessons-saved-highlight';
    var SCROLL_DELAY_MS = 200;   // small pause so layout is stable
    var HIGHLIGHT_MS    = 2000;  // how long the highlight pulse lasts

    /* ------------------------------------------------------------------ */
    /*  Helper – read the item-id that is about to be saved               */
    /* ------------------------------------------------------------------ */

    /**
     * Given a jQuery dialog element, try to find the item-id that will be
     * saved.  Each dialog stores it in a different hidden field.
     *
     * Returns the id as a string, or null when not determinable (e.g. when
     * adding brand-new content whose id is not yet known server-side).
     */
    function getItemIdFromDialog($dialog) {
        // Dialogs that edit existing items populate one of these hidden fields
        var candidates = [
            '#item-id',           // edit-item-dialog
            '#mm-item-id',        // add-multimedia-dialog (edit mode)
            '#multimedia-item-id',// edit-multimedia-dialog
            '#youtubeEditId',     // youtube-dialog
            '#movieEditId',       // movie-dialog
            '#commentsEditId',    // comments-dialog
            '#studentEditId',     // student-dialog
            '#questionEditId',    // question-dialog
        ];

        for (var i = 0; i < candidates.length; i++) {
            var val = $dialog.find(candidates[i]).val();
            if (val && val !== '0' && val !== '') {
                return val;
            }
        }
        return null;
    }

    /**
     * When adding NEW content we don't know the future DB id yet, but we can
     * use the "add-before" item id as a positional hint: after reload we scroll
     * to the item that immediately precedes the insertion point, which keeps
     * the user close to where they were working.
     */
    function getAddBeforeFromDialog($dialog) {
        var candidates = [
            '#mm-add-before',
            '#subpage-add-before',
            '#calendar-addBefore',
            '#comments-addBefore',
            '#add-student-addBefore',
            '#question-addBefore',
            '#twitter-addBefore',
            '#announcements-add-before',
            '#forum-summary-add-before',
        ];
        for (var i = 0; i < candidates.length; i++) {
            var val = $dialog.find(candidates[i]).val();
            if (val && val !== '0' && val !== '') {
                return 'before-' + val;   // prefixed to distinguish from item ids
            }
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Store id before submit                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Attach a one-time "beforeunload / submit" listener on every save button
     * inside a dialog so we capture the item-id just before the page leaves.
     */
    function attachSaveListeners() {

        // Map: save-button selector → parent dialog selector
        var buttonToDialog = {
            '#edit-item'           : '#edit-item-dialog',
            '#mm-add-item'         : '#add-multimedia-dialog',
            '#edit-multimedia-item': '#edit-multimedia-dialog',
            '#update-youtube'      : '#youtube-dialog',
            '#update-movie'        : '#movie-dialog',
            '#update-comments'     : '#comments-dialog',
            '#update-student'      : '#student-dialog',
            '#update-question'     : '#question-dialog',
            '#create-subpage'      : '#subpage-dialog',
            '#announcements-add-item'   : '#add-announcements-dialog',
            '#forum-summary-add-item'   : '#add-forum-summary-dialog',
            '#add-comment'         : '.commentArea',   // inline comment form
        };

        $.each(buttonToDialog, function (btnSelector, dialogSelector) {
            $(document).on('click', btnSelector, function () {
                var $dialog = $(dialogSelector);
                var itemId  = getItemIdFromDialog($dialog)
                           || getAddBeforeFromDialog($dialog);

                if (itemId) {
                    try {
                        sessionStorage.setItem(STORAGE_KEY, itemId);
                    } catch (e) {
                        // sessionStorage unavailable (private browsing, quota) – silently skip
                    }
                }
            });
        });

        // Inline text editor saves via a different mechanism; the active item
        // is tracked by Sakai in #activeQuestion or the first .canEdit element
        // that was clicked.  We piggy-back on the existing editText path.
        $(document).on('click', '.submitButton', function () {
            // submitButton is used by the inline comment/answer forms
            var $form  = $(this).closest('form');
            var itemId = $form.find('input[rsf\\:id="comment-item-id"]').val()
                      || $form.find('.comment-edit-id').val();
            if (itemId) {
                try { sessionStorage.setItem(STORAGE_KEY, itemId); } catch (e) {}
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Scroll to element after reload                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Find the DOM element that corresponds to the stored item-id and scroll
     * to it, then briefly highlight it so the user's eye lands on it.
     */
    function scrollToSavedItem() {
        var rawId;
        try {
            rawId = sessionStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return;
        }
        if (!rawId) { return; }

        // Always clean up first so a failed lookup doesn't loop forever
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}

        setTimeout(function () {
            var $target;

            if (rawId.indexOf('before-') === 0) {
                // Positional hint: scroll to the item with id === trimmed value
                var refId = rawId.slice('before-'.length);
                $target = findItemElementById(refId);
            } else {
                $target = findItemElementById(rawId);
            }

            if ($target && $target.length) {
                scrollAndHighlight($target);
            }
        }, SCROLL_DELAY_MS);
    }

    /**
     * Locate the outermost .item div whose hidden .current-item-id2 span
     * contains the given id, OR find any element with a matching data-itemid.
     */
    function findItemElementById(id) {
        var $found = null;

        // Strategy 1: Sakai renders the item id inside a hidden span with
        // class "current-item-id2" (or "mm-itemid") inside every item row.
        $('.current-item-id2, .mm-itemid, .movie-id, .youtube-id, ' +
          '.comments-id, .student-id, .question-id, .calendar-item-id').each(function () {
            if (String($(this).text()).trim() === String(id).trim()) {
                // Walk up to the enclosing .item or .right-col container
                var $row = $(this).closest('.item, [role="listitem"]');
                if (!$row.length) {
                    $row = $(this).closest('.right-col').parent();
                }
                $found = $row;
                return false; // break $.each
            }
        });

        // Strategy 2: fallback – look for a hidden span whose text matches
        if (!$found) {
            $('span[style*="display:none"], div[style*="display:none"]').each(function () {
                if (String($(this).text()).trim() === String(id).trim()) {
                    var $row = $(this).closest('.item, [role="listitem"]');
                    if ($row.length) {
                        $found = $row;
                        return false;
                    }
                }
            });
        }

        return $found;
    }

    /**
     * Smooth-scroll to $el and apply a brief CSS highlight animation.
     */
    function scrollAndHighlight($el) {
        // Ensure the element is inside a collapsed section and expand it
        var $collapsible = $el.closest('.collapse');
        if ($collapsible.length && !$collapsible.hasClass('show')) {
            $collapsible.addClass('show');
        }

        // Scroll – use native scrollIntoView when available for smoothness
        var el = $el[0];
        if (el.scrollIntoView) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            var offset = $el.offset().top - 80;
            $('html, body').animate({ scrollTop: offset }, 400);
        }

        // Visual pulse so the user's eye lands on the right element
        $el.addClass(HIGHLIGHT_CLASS);
        setTimeout(function () {
            $el.removeClass(HIGHLIGHT_CLASS);
        }, HIGHLIGHT_MS);
    }

    /* ------------------------------------------------------------------ */
    /*  CSS for the highlight pulse (injected once at runtime)            */
    /* ------------------------------------------------------------------ */

    function injectStyles() {
        if ($('#lessons-sak52363-styles').length) { return; }
        $('<style id="lessons-sak52363-styles">\n' +
            '@keyframes lessonsSavedPulse {\n' +
            '  0%   { box-shadow: 0 0 0 0   rgba(0, 112, 201, 0.55); background-color: rgba(0, 112, 201, 0.10); }\n' +
            '  40%  { box-shadow: 0 0 0 8px rgba(0, 112, 201, 0.15); background-color: rgba(0, 112, 201, 0.14); }\n' +
            '  100% { box-shadow: 0 0 0 0   rgba(0, 112, 201, 0);    background-color: transparent; }\n' +
            '}\n' +
            '.' + HIGHLIGHT_CLASS + ' {\n' +
            '  border-radius: 4px;\n' +
            '  animation: lessonsSavedPulse ' + (HIGHLIGHT_MS / 1000) + 's ease-out forwards;\n' +
            '}\n' +
          '</style>').appendTo('head');
    }

    /* ------------------------------------------------------------------ */
    /*  Bootstrap                                                          */
    /* ------------------------------------------------------------------ */

    $(document).ready(function () {
        injectStyles();
        attachSaveListeners();
        scrollToSavedItem();
    });

}(jQuery));
