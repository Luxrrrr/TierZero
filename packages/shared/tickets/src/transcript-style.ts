/**
 * The look of a transcript, shared by the dashboard and the downloaded file.
 * Every colour, size and radius is a `--dt-*` variable on `.dt`, and the
 * defaults are Discord's dark theme, so the downloaded file looks like the
 * channel did and needs nothing else. The dashboard sets the same variables
 * from its own tokens, which is how the view follows the dashboard's theme.
 * Every rule is scoped under `.dt` so it cannot leak into the dashboard.
 *
 * Discord's own typeface, gg sans, is not freely licensed and is not bundled;
 * the stack falls back to Noto Sans and then to common system fonts.
 */
export const TRANSCRIPT_CSS = `
.dt{--dt-bg:#313338;--dt-bg-alt:#2b2d31;--dt-bg-deep:#1e1f22;--dt-text:#dbdee1;--dt-strong:#f2f3f5;--dt-muted:#949ba4;--dt-faint:#80848e;--dt-soft:#b5bac1;--dt-link:#00a8fc;--dt-line:#3f4147;--dt-hover:#2e3035;--dt-mention-bg:rgba(88,101,242,.3);--dt-mention-text:#c9cdfb;--dt-blurple:#5865f2;--dt-danger:#f23f43;--dt-danger-text:#fa777c;--dt-danger-bg:rgba(242,63,67,.05);--dt-chip:rgba(78,80,88,.48);--dt-quote-bar:#4e5058;--dt-reply-line:#4e5058;--dt-file-line:#232428;--dt-file-icon:#7984f5;--dt-spoiler-hover:#17181a;--dt-spoiler-open:rgba(255,255,255,.1);--dt-welcome-icon:#41434a;--dt-activity-line:#f0b232;--dt-activity-bg:rgba(240,178,50,.08);--dt-activity-text:#f6d58e;--dt-btn-primary:#5865f2;--dt-btn-secondary:#4e5058;--dt-btn-secondary-text:#fff;--dt-btn-secondary-ring:transparent;--dt-btn-success:#248046;--dt-btn-danger:#da373c;--dt-btn-height:32px;--dt-btn-radius:8px;--dt-btn-size:14px;--dt-embed-border:0 solid transparent;--dt-embed-radius:4px;--dt-reaction-border:transparent;--dt-reaction-radius:8px;--dt-font:"gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif;--dt-mono:"gg mono",Consolas,"Andale Mono WT","Andale Mono","Lucida Console","DejaVu Sans Mono","Liberation Mono",Monaco,"Courier New",monospace;--dt-size:16px;--dt-lh:22px;--dt-small:14px;--dt-small-lh:18px;--dt-meta:12px;--dt-pad:16px;--dt-pad-right:48px;--dt-gap:16px;--dt-avatar:40px;--dt-row-inset:0px;--dt-row-radius:0px;
color-scheme:dark;background:var(--dt-bg);color:var(--dt-text);font-family:var(--dt-font);font-size:var(--dt-size);line-height:1.375;text-align:left;-webkit-font-smoothing:antialiased;overflow-wrap:break-word;min-width:0}
.dt *,.dt *::before,.dt *::after{box-sizing:border-box}
.dt h2,.dt h3,.dt p,.dt ol,.dt ul,.dt blockquote,.dt pre{margin:0}
.dt img{border:0}
.dt a{color:var(--dt-link);text-decoration:none}
.dt a:hover{text-decoration:underline}
.dt-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;min-height:48px;padding:0 var(--dt-pad);background:var(--dt-bg);box-shadow:0 1px 0 rgba(4,4,5,.2),0 1.5px 0 rgba(6,6,7,.05),0 2px 0 rgba(4,4,5,.05)}
.dt-header-icon{flex:none;width:24px;height:24px;color:var(--dt-faint)}
.dt-header-name{flex:none;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dt-size);line-height:20px;font-weight:600;color:var(--dt-strong)}
.dt-header-divider{flex:none;width:1px;height:24px;margin:0 4px;background:var(--dt-line)}
.dt-header-topic{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dt-small);line-height:18px;font-weight:500;color:var(--dt-soft)}
.dt-chat{padding-bottom:24px}
.dt-welcome{margin:var(--dt-pad);padding-top:16px}
.dt-welcome-icon{display:flex;align-items:center;justify-content:center;width:68px;height:68px;margin-bottom:8px;border-radius:50%;background:var(--dt-welcome-icon);color:#fff}
.dt-welcome-hash{width:42px;height:42px}
.dt-welcome-title{margin:8px 0;font-size:32px;line-height:40px;font-weight:700;color:var(--dt-strong)}
.dt-welcome-text{font-size:var(--dt-size);line-height:20px;color:var(--dt-soft)}
.dt-empty{margin:var(--dt-pad);color:var(--dt-muted);font-size:var(--dt-small)}
.dt-messages{list-style:none;margin:0;padding:0}
.dt-divider{position:relative;display:flex;align-items:center;justify-content:center;height:0;margin:24px var(--dt-pad) 8px var(--dt-pad);border-top:1px solid var(--dt-line)}
.dt-divider-text{display:block;margin-top:-1px;padding:2px 4px;background:var(--dt-bg);color:var(--dt-muted);font-size:var(--dt-meta);line-height:13px;font-weight:600;border-radius:8px}
.dt-message{position:relative;min-height:22px;margin:0 var(--dt-row-inset);padding:2px var(--dt-pad-right) 2px calc(var(--dt-pad) - var(--dt-row-inset) + var(--dt-avatar) + var(--dt-gap));border-radius:var(--dt-row-radius)}
.dt-message:hover{background:var(--dt-hover)}
.dt-message-start{margin-top:17px;min-height:calc(var(--dt-avatar) + 4px)}
.dt-avatar{position:absolute;left:calc(var(--dt-pad) - var(--dt-row-inset));top:2px;width:var(--dt-avatar);height:var(--dt-avatar);border-radius:50%;object-fit:cover;background:var(--dt-bg-alt)}
.dt-message-reply .dt-avatar{top:24px}
.dt-message-head{display:block;margin:0;font-size:var(--dt-size);line-height:var(--dt-lh);font-weight:500;color:var(--dt-strong);min-height:var(--dt-lh);white-space:normal}
.dt-name{font-weight:500;color:var(--dt-strong);margin-right:4px}
.dt-tag{display:inline-flex;align-items:center;height:15px;margin-right:4px;padding:0 4.4px;border-radius:3px;background:var(--dt-blurple);color:#fff;font-size:10px;line-height:15px;font-weight:600;vertical-align:2px;text-transform:uppercase}
.dt-via{display:inline-flex;align-items:center;height:15px;margin-right:4px;padding:0 4.4px;border-radius:3px;background:rgba(255,255,255,.12);color:var(--dt-strong);font-size:10px;line-height:15px;font-weight:600;vertical-align:2px;text-transform:uppercase;cursor:default}
.dt-sender{margin-right:4px;font-size:var(--dt-meta);font-weight:400;color:var(--dt-muted)}
.dt-time{font-size:var(--dt-meta);line-height:var(--dt-lh);font-weight:500;color:var(--dt-muted);vertical-align:baseline}
.dt-gutter-time{position:absolute;left:0;top:4px;width:calc(var(--dt-pad) - var(--dt-row-inset) + var(--dt-avatar));text-align:right;font-size:11px;line-height:var(--dt-lh);color:var(--dt-muted);opacity:0}
.dt-message:hover .dt-gutter-time{opacity:1}
.dt-content{font-size:var(--dt-size);line-height:var(--dt-lh);color:var(--dt-text);white-space:pre-wrap;overflow-wrap:anywhere}
.dt-content-jumbo .dt-emoji{width:48px;height:48px;min-height:48px}
.dt-content-jumbo .dt-emoji-u{font-size:48px;line-height:56px}
.dt-edited{margin-left:4px;font-size:10px;line-height:1;color:var(--dt-muted);white-space:nowrap}
.dt strong{font-weight:700}
.dt-code{padding:.2em;margin:-.2em 0;border-radius:4px;background:var(--dt-bg-alt);border:1px solid var(--dt-bg-deep);font-family:var(--dt-mono);font-size:85%;line-height:1.125rem;white-space:pre-wrap}
.dt-codeblock{position:relative;max-width:90%;margin:6px 0 0;padding:7px;border-radius:4px;background:var(--dt-bg-alt);border:1px solid var(--dt-bg-deep);color:var(--dt-soft);font-family:var(--dt-mono);font-size:var(--dt-small);line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.dt-codeblock code{font:inherit;color:inherit;background:none;border:0;padding:0}
.dt-codeblock-lang{float:right;margin:-3px -3px 0 8px;padding:0 6px;border-radius:3px;background:var(--dt-bg-deep);color:var(--dt-muted);font-family:var(--dt-font);font-size:11px;line-height:18px;font-weight:600;text-transform:lowercase}
.dt-quote{display:block;position:relative;margin:2px 0;padding:0 8px 0 12px;border-left:4px solid var(--dt-quote-bar);border-radius:4px 0 0 4px;white-space:pre-wrap}
.dt-h{margin:8px 0 4px;color:var(--dt-strong);font-weight:700;line-height:1.375;white-space:pre-wrap}
.dt-h1{font-size:1.5em}
.dt-h2{font-size:1.25em}
.dt-h3{font-size:1em}
.dt-subtext{display:block;font-size:.8125em;line-height:1.11rem;color:var(--dt-muted)}
.dt-list{margin:4px 0 0 16px;padding:0 0 0 16px;white-space:normal;list-style:disc outside}
.dt-list .dt-list{list-style-type:circle}
ol.dt-list{list-style:decimal outside}
.dt-list li{display:list-item;margin-bottom:4px;white-space:pre-wrap}
.dt-link{color:var(--dt-link)}
.dt-mention{padding:0 2px;border-radius:3px;background:var(--dt-mention-bg);color:var(--dt-mention-text);font-weight:500;unicode-bidi:plaintext}
.dt-emoji{display:inline-block;width:22px;height:22px;margin:0 1px;vertical-align:-6px;object-fit:contain}
.dt-emoji-u{font-size:22px;line-height:22px;vertical-align:-2px;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
.dt-timestamp{padding:0 2px;border-radius:3px;background:var(--dt-chip)}
.dt-spoiler{position:relative;display:inline;cursor:pointer;border-radius:4px}
.dt-spoiler-input{position:absolute;width:1px;height:1px;margin:0;padding:0;opacity:0;pointer-events:none}
.dt-spoiler-text{border-radius:4px;background:var(--dt-bg-deep);color:transparent;transition:background-color .1s}
.dt-spoiler-text *{visibility:hidden}
.dt-spoiler:hover .dt-spoiler-text{background:var(--dt-spoiler-hover)}
.dt-spoiler-input:focus-visible+.dt-spoiler-text{outline:2px solid var(--dt-link);outline-offset:1px}
.dt-spoiler-input:checked+.dt-spoiler-text{background:var(--dt-spoiler-open);color:inherit;cursor:text}
.dt-spoiler-input:checked+.dt-spoiler-text *{visibility:visible}
.dt-spoiler-media{display:block;width:max-content;max-width:100%}
.dt-spoiler-media .dt-spoiler-text{display:block;background:none}
.dt-spoiler-media .dt-spoiler-text *{visibility:visible}
.dt-spoiler-media .dt-spoiler-input:not(:checked)+.dt-spoiler-text img{filter:blur(44px);}
.dt-spoiler-media .dt-spoiler-input:not(:checked)+.dt-spoiler-text a{pointer-events:none}
.dt-spoiler-media .dt-spoiler-text{overflow:hidden;border-radius:8px}
.dt-media{display:block;width:max-content;max-width:100%;margin-top:4px;border-radius:8px;overflow:hidden;line-height:0}
.dt-media-image{display:block;max-width:min(550px,100%);max-height:350px;border-radius:8px;object-fit:contain}
.dt-file{display:flex;align-items:center;gap:8px;width:432px;max-width:100%;margin-top:4px;padding:16px;border-radius:8px;background:var(--dt-bg-alt);border:1px solid var(--dt-file-line)}
.dt-file-icon{flex:none;width:30px;height:40px;color:var(--dt-file-icon)}
.dt-file-meta{min-width:0;flex:1 1 auto}
.dt-file-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dt-size);line-height:22px;color:var(--dt-link)}
.dt-file-size{font-size:var(--dt-meta);line-height:16px;color:var(--dt-muted)}
.dt-embed{position:relative;display:grid;max-width:520px;margin-top:4px;border:var(--dt-embed-border);border-left:4px solid var(--dt-bg-deep);border-radius:var(--dt-embed-radius);background:var(--dt-bg-alt);white-space:normal}
.dt-embed-grid{display:grid;grid-template-columns:auto;grid-template-rows:auto;padding:8px 16px 16px 12px;overflow:hidden}
.dt-embed-has-thumbnail .dt-embed-grid{grid-template-columns:minmax(0,1fr) auto}
.dt-embed-grid>*{grid-column:1/2;min-width:0}
.dt-embed-provider{margin-top:8px;font-size:var(--dt-meta);line-height:16px;font-weight:400;color:var(--dt-soft)}
.dt-embed-provider-name{color:var(--dt-soft)}
.dt-embed-author{display:flex;align-items:center;margin-top:8px}
.dt-embed-author-icon{width:24px;height:24px;margin-right:8px;border-radius:50%;object-fit:contain}
.dt-embed-author-name{font-size:var(--dt-small);line-height:22px;font-weight:600;color:var(--dt-strong)}
a.dt-embed-author-name{color:var(--dt-strong)}
.dt-embed-title{margin-top:8px;font-size:var(--dt-size);line-height:22px;font-weight:600;color:var(--dt-strong);white-space:pre-wrap}
a.dt-embed-title-link{color:var(--dt-link)}
.dt-embed-description{margin-top:8px;font-size:var(--dt-small);line-height:var(--dt-small-lh);color:var(--dt-text);white-space:pre-wrap}
.dt-embed-description .dt-codeblock,.dt-embed-field-value .dt-codeblock{max-width:100%}
.dt-embed-fields{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px;margin-top:8px}
.dt-embed-field{min-width:0;font-size:var(--dt-small);line-height:var(--dt-small-lh)}
.dt-embed-field-name{margin-bottom:2px;font-weight:600;color:var(--dt-strong);white-space:pre-wrap}
.dt-embed-field-value{color:var(--dt-text);white-space:pre-wrap}
.dt-embed-image{display:block;margin-top:16px;border-radius:4px;overflow:hidden;line-height:0;width:max-content;max-width:100%}
.dt-embed-image img{display:block;max-width:min(400px,100%);max-height:300px;border-radius:4px;object-fit:contain}
.dt-embed-thumbnail{grid-column:2/3!important;grid-row:1/8;align-self:start;justify-self:end;margin:8px 0 0 16px;line-height:0}
.dt-embed-thumbnail img{display:block;max-width:80px;max-height:80px;border-radius:4px;object-fit:contain}
.dt-embed-footer{display:flex;align-items:center;margin-top:8px;font-size:var(--dt-meta);line-height:16px;font-weight:500;color:var(--dt-text)}
.dt-embed-footer-icon{width:20px;height:20px;margin-right:8px;border-radius:50%;object-fit:contain}
.dt-embed-footer-separator{margin:0 4px;font-weight:500}
.dt-components{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.dt-component-row{display:flex;flex-wrap:wrap;gap:8px}
.dt-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:60px;height:var(--dt-btn-height);padding:2px 16px;border-radius:var(--dt-btn-radius);color:#fff;font-size:var(--dt-btn-size);line-height:16px;font-weight:500;white-space:nowrap;user-select:none;cursor:default}
.dt-button-primary{background:var(--dt-btn-primary)}
.dt-button-secondary,.dt-button-link,.dt-button-premium{background:var(--dt-btn-secondary);color:var(--dt-btn-secondary-text);box-shadow:inset 0 0 0 1px var(--dt-btn-secondary-ring)}
.dt-button-success{background:var(--dt-btn-success)}
.dt-button-danger{background:var(--dt-btn-danger)}
.dt-button .dt-emoji,.dt-button .dt-emoji-u{width:18px;height:18px;margin:0;font-size:18px;line-height:18px;vertical-align:0}
.dt-button-external{width:16px;height:16px;margin-left:2px}
.dt-disabled{opacity:.5;cursor:not-allowed}
.dt-select{display:flex;align-items:center;justify-content:space-between;width:400px;max-width:100%;height:40px;padding:8px 8px 8px 12px;border-radius:4px;background:var(--dt-bg-deep);border:1px solid var(--dt-bg-deep);color:var(--dt-muted);font-size:var(--dt-size);font-weight:500}
.dt-select-caret{width:24px;height:24px;color:var(--dt-strong)}
.dt-sticker{margin-top:4px;line-height:0}
.dt-sticker img{width:160px;height:160px;object-fit:contain}
.dt-sticker-placeholder{display:inline-flex;align-items:center;justify-content:center;width:160px;height:160px;padding:8px;border-radius:8px;background:var(--dt-bg-alt);color:var(--dt-muted);font-size:var(--dt-small);line-height:18px;text-align:center}
.dt-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dt-reaction{display:inline-flex;align-items:center;gap:6px;height:28px;padding:2px 6px;border-radius:var(--dt-reaction-radius);background:var(--dt-bg-alt);border:1px solid var(--dt-reaction-border);color:var(--dt-soft)}
.dt-reaction .dt-emoji{width:16px;height:16px;margin:0;vertical-align:0}
.dt-reaction .dt-emoji-u{font-size:16px;line-height:16px;vertical-align:0}
.dt-reaction-count{font-size:var(--dt-small);line-height:16px;font-weight:600}
.dt-reply{position:relative;display:flex;align-items:center;gap:4px;height:18px;margin-bottom:4px;font-size:var(--dt-small);line-height:18px;color:var(--dt-soft);white-space:nowrap;overflow:hidden}
.dt-reply::before{content:"";position:absolute;display:block;left:calc(-1*(var(--dt-gap) + var(--dt-avatar)/2));top:8px;width:calc(var(--dt-gap) + var(--dt-avatar)/2 - 3px);height:12px;border-top:2px solid var(--dt-reply-line);border-left:2px solid var(--dt-reply-line);border-top-left-radius:6px;box-sizing:border-box}
.dt-message .dt-reply{overflow:visible}
.dt-reply-avatar{flex:none;width:16px;height:16px;border-radius:50%;object-fit:cover}
.dt-reply-name{flex:none;font-weight:500;color:var(--dt-strong);opacity:.64}
.dt-reply-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dt-reply-missing .dt-reply-text{font-style:italic;color:var(--dt-muted)}
.dt-message-deleted{box-shadow:inset 2px 0 0 var(--dt-danger);background:var(--dt-danger-bg)}
.dt-message-deleted>:not(.dt-deleted-note):not(.dt-gutter-time){opacity:.55}
.dt-deleted-note{margin-top:2px;font-size:var(--dt-meta);line-height:16px;font-weight:500;color:var(--dt-danger-text)}
.dt-activity{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:8px var(--dt-pad) 8px calc(var(--dt-pad) + var(--dt-avatar) + var(--dt-gap));padding:6px 10px;border:1px dashed var(--dt-activity-line);border-radius:6px;background:var(--dt-activity-bg);color:var(--dt-activity-text);font-size:13px;line-height:18px}
.dt-activity-detail{color:var(--dt-soft)}
.dt-activity-time{margin-left:auto;font-size:11px;color:var(--dt-muted)}
@media (max-width:600px){.dt{--dt-pad-right:16px}.dt-file,.dt-select{width:100%}.dt-embed{max-width:100%}.dt-welcome-title{font-size:24px;line-height:30px}}
@media (prefers-reduced-motion:reduce){.dt-spoiler-text{transition:none}}
`.trim();
