/**
 * The look of a transcript, shared by the dashboard and the downloaded file.
 * It is Discord's dark theme whatever the page around it uses, because the
 * point is to show the ticket the way it looked in Discord. Every rule is
 * scoped under `.dt` so it cannot leak into the dashboard.
 *
 * Discord's own typeface, gg sans, is not freely licensed and is not bundled;
 * the stack falls back to Noto Sans and then to common system fonts.
 */
export const TRANSCRIPT_CSS = `
.dt{--dt-bg:#313338;--dt-bg-alt:#2b2d31;--dt-bg-deep:#1e1f22;--dt-text:#dbdee1;--dt-strong:#f2f3f5;--dt-muted:#949ba4;--dt-faint:#80848e;--dt-soft:#b5bac1;--dt-link:#00a8fc;--dt-line:#3f4147;--dt-hover:#2e3035;--dt-mention-bg:rgba(88,101,242,.3);--dt-mention-text:#c9cdfb;--dt-blurple:#5865f2;--dt-danger:#f23f43;
color-scheme:dark;background:var(--dt-bg);color:var(--dt-text);font-family:"gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.375;text-align:left;-webkit-font-smoothing:antialiased;overflow-wrap:break-word;min-width:0}
.dt *,.dt *::before,.dt *::after{box-sizing:border-box}
.dt h2,.dt h3,.dt p,.dt ol,.dt ul,.dt blockquote,.dt pre{margin:0}
.dt img{border:0}
.dt a{color:var(--dt-link);text-decoration:none}
.dt a:hover{text-decoration:underline}
.dt-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;min-height:48px;padding:0 16px;background:var(--dt-bg);box-shadow:0 1px 0 rgba(4,4,5,.2),0 1.5px 0 rgba(6,6,7,.05),0 2px 0 rgba(4,4,5,.05)}
.dt-header-icon{flex:none;width:24px;height:24px;color:var(--dt-faint)}
.dt-header-name{flex:none;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:20px;font-weight:600;color:var(--dt-strong)}
.dt-header-divider{flex:none;width:1px;height:24px;margin:0 4px;background:var(--dt-line)}
.dt-header-topic{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:18px;font-weight:500;color:var(--dt-soft)}
.dt-chat{padding-bottom:24px}
.dt-welcome{margin:16px;padding-top:16px}
.dt-welcome-icon{display:flex;align-items:center;justify-content:center;width:68px;height:68px;margin-bottom:8px;border-radius:50%;background:#41434a;color:#fff}
.dt-welcome-hash{width:42px;height:42px}
.dt-welcome-title{margin:8px 0;font-size:32px;line-height:40px;font-weight:700;color:var(--dt-strong)}
.dt-welcome-text{font-size:16px;line-height:20px;color:var(--dt-soft)}
.dt-empty{margin:16px;color:var(--dt-muted);font-size:14px}
.dt-messages{list-style:none;margin:0;padding:0}
.dt-divider{position:relative;display:flex;align-items:center;justify-content:center;height:0;margin:24px 16px 8px 16px;border-top:1px solid var(--dt-line)}
.dt-divider-text{display:block;margin-top:-1px;padding:2px 4px;background:var(--dt-bg);color:var(--dt-muted);font-size:12px;line-height:13px;font-weight:600;border-radius:8px}
.dt-message{position:relative;min-height:22px;padding:2px 48px 2px 72px;margin:0}
.dt-message:hover{background:var(--dt-hover)}
.dt-message-start{margin-top:17px;min-height:44px}
.dt-avatar{position:absolute;left:16px;top:2px;width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--dt-bg-alt)}
.dt-message-reply .dt-avatar{top:24px}
.dt-message-head{display:block;margin:0;font-size:16px;line-height:22px;font-weight:500;color:var(--dt-strong);min-height:22px;white-space:normal}
.dt-name{font-weight:500;color:var(--dt-strong);margin-right:4px}
.dt-tag{display:inline-flex;align-items:center;height:15px;margin-right:4px;padding:0 4.4px;border-radius:3px;background:var(--dt-blurple);color:#fff;font-size:10px;line-height:15px;font-weight:600;vertical-align:2px;text-transform:uppercase}
.dt-time{font-size:12px;line-height:22px;font-weight:500;color:var(--dt-muted);vertical-align:baseline}
.dt-gutter-time{position:absolute;left:0;top:4px;width:56px;text-align:right;font-size:11px;line-height:22px;color:var(--dt-muted);opacity:0}
.dt-message:hover .dt-gutter-time{opacity:1}
.dt-content{font-size:16px;line-height:22px;color:var(--dt-text);white-space:pre-wrap;overflow-wrap:anywhere}
.dt-content-jumbo .dt-emoji{width:48px;height:48px;min-height:48px}
.dt-content-jumbo .dt-emoji-u{font-size:48px;line-height:56px}
.dt-edited{margin-left:4px;font-size:10px;line-height:1;color:var(--dt-muted);white-space:nowrap}
.dt strong{font-weight:700}
.dt-code{padding:.2em;margin:-.2em 0;border-radius:4px;background:var(--dt-bg-alt);border:1px solid var(--dt-bg-deep);font-family:"gg mono",Consolas,"Andale Mono WT","Andale Mono","Lucida Console","DejaVu Sans Mono","Liberation Mono",Monaco,"Courier New",monospace;font-size:85%;line-height:1.125rem;white-space:pre-wrap}
.dt-codeblock{position:relative;max-width:90%;margin:6px 0 0;padding:7px;border-radius:4px;background:var(--dt-bg-alt);border:1px solid var(--dt-bg-deep);color:var(--dt-soft);font-family:"gg mono",Consolas,"Andale Mono WT","Andale Mono","Lucida Console","DejaVu Sans Mono","Liberation Mono",Monaco,"Courier New",monospace;font-size:14px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.dt-codeblock code{font:inherit;color:inherit;background:none;border:0;padding:0}
.dt-codeblock-lang{float:right;margin:-3px -3px 0 8px;padding:0 6px;border-radius:3px;background:var(--dt-bg-deep);color:var(--dt-muted);font-family:"gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:11px;line-height:18px;font-weight:600;text-transform:lowercase}
.dt-quote{display:block;position:relative;margin:2px 0;padding:0 8px 0 12px;border-left:4px solid #4e5058;border-radius:4px 0 0 4px;white-space:pre-wrap}
.dt-h{margin:8px 0 4px;color:var(--dt-strong);font-weight:700;line-height:1.375;white-space:pre-wrap}
.dt-h1{font-size:24px}
.dt-h2{font-size:20px}
.dt-h3{font-size:16px}
.dt-subtext{display:block;font-size:13px;line-height:1.11rem;color:var(--dt-muted)}
.dt-list{margin:4px 0 0 16px;padding:0 0 0 16px;white-space:normal;list-style:disc outside}
.dt-list .dt-list{list-style-type:circle}
ol.dt-list{list-style:decimal outside}
.dt-list li{display:list-item;margin-bottom:4px;white-space:pre-wrap}
.dt-link{color:var(--dt-link)}
.dt-mention{padding:0 2px;border-radius:3px;background:var(--dt-mention-bg);color:var(--dt-mention-text);font-weight:500;unicode-bidi:plaintext}
.dt-emoji{display:inline-block;width:22px;height:22px;margin:0 1px;vertical-align:-6px;object-fit:contain}
.dt-emoji-u{font-size:22px;line-height:22px;vertical-align:-2px;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
.dt-timestamp{padding:0 2px;border-radius:3px;background:rgba(78,80,88,.48)}
.dt-spoiler{position:relative;display:inline;cursor:pointer;border-radius:4px}
.dt-spoiler-input{position:absolute;width:1px;height:1px;margin:0;padding:0;opacity:0;pointer-events:none}
.dt-spoiler-text{border-radius:4px;background:var(--dt-bg-deep);color:transparent;transition:background-color .1s}
.dt-spoiler-text *{visibility:hidden}
.dt-spoiler:hover .dt-spoiler-text{background:#17181a}
.dt-spoiler-input:focus-visible+.dt-spoiler-text{outline:2px solid var(--dt-link);outline-offset:1px}
.dt-spoiler-input:checked+.dt-spoiler-text{background:rgba(255,255,255,.1);color:inherit;cursor:text}
.dt-spoiler-input:checked+.dt-spoiler-text *{visibility:visible}
.dt-spoiler-media{display:block;width:max-content;max-width:100%}
.dt-spoiler-media .dt-spoiler-text{display:block;background:none}
.dt-spoiler-media .dt-spoiler-text *{visibility:visible}
.dt-spoiler-media .dt-spoiler-input:not(:checked)+.dt-spoiler-text img{filter:blur(44px);}
.dt-spoiler-media .dt-spoiler-input:not(:checked)+.dt-spoiler-text a{pointer-events:none}
.dt-spoiler-media .dt-spoiler-text{overflow:hidden;border-radius:8px}
.dt-media{display:block;width:max-content;max-width:100%;margin-top:4px;border-radius:8px;overflow:hidden;line-height:0}
.dt-media-image{display:block;max-width:min(550px,100%);max-height:350px;border-radius:8px;object-fit:contain}
.dt-file{display:flex;align-items:center;gap:8px;width:432px;max-width:100%;margin-top:4px;padding:16px;border-radius:8px;background:var(--dt-bg-alt);border:1px solid #232428}
.dt-file-icon{flex:none;width:30px;height:40px;color:#7984f5}
.dt-file-meta{min-width:0;flex:1 1 auto}
.dt-file-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;line-height:22px;color:var(--dt-link)}
.dt-file-size{font-size:12px;line-height:16px;color:var(--dt-muted)}
.dt-embed{position:relative;display:grid;max-width:520px;margin-top:4px;border-radius:4px;background:var(--dt-bg-alt);border-left:4px solid var(--dt-bg-deep);white-space:normal}
.dt-embed-grid{display:grid;grid-template-columns:auto;grid-template-rows:auto;padding:8px 16px 16px 12px;overflow:hidden}
.dt-embed-has-thumbnail .dt-embed-grid{grid-template-columns:minmax(0,1fr) auto}
.dt-embed-grid>*{grid-column:1/2;min-width:0}
.dt-embed-provider{margin-top:8px;font-size:12px;line-height:16px;font-weight:400;color:var(--dt-soft)}
.dt-embed-provider-name{color:var(--dt-soft)}
.dt-embed-author{display:flex;align-items:center;margin-top:8px}
.dt-embed-author-icon{width:24px;height:24px;margin-right:8px;border-radius:50%;object-fit:contain}
.dt-embed-author-name{font-size:14px;line-height:22px;font-weight:600;color:var(--dt-strong)}
a.dt-embed-author-name{color:var(--dt-strong)}
.dt-embed-title{margin-top:8px;font-size:16px;line-height:22px;font-weight:600;color:var(--dt-strong);white-space:pre-wrap}
a.dt-embed-title-link{color:var(--dt-link)}
.dt-embed-description{margin-top:8px;font-size:14px;line-height:18px;color:var(--dt-text);white-space:pre-wrap}
.dt-embed-description .dt-codeblock,.dt-embed-field-value .dt-codeblock{max-width:100%}
.dt-embed-fields{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px;margin-top:8px}
.dt-embed-field{min-width:0;font-size:14px;line-height:18px}
.dt-embed-field-name{margin-bottom:2px;font-weight:600;color:var(--dt-strong);white-space:pre-wrap}
.dt-embed-field-value{color:var(--dt-text);white-space:pre-wrap}
.dt-embed-image{display:block;margin-top:16px;border-radius:4px;overflow:hidden;line-height:0;width:max-content;max-width:100%}
.dt-embed-image img{display:block;max-width:min(400px,100%);max-height:300px;border-radius:4px;object-fit:contain}
.dt-embed-thumbnail{grid-column:2/3!important;grid-row:1/8;align-self:start;justify-self:end;margin:8px 0 0 16px;line-height:0}
.dt-embed-thumbnail img{display:block;max-width:80px;max-height:80px;border-radius:4px;object-fit:contain}
.dt-embed-footer{display:flex;align-items:center;margin-top:8px;font-size:12px;line-height:16px;font-weight:500;color:var(--dt-text)}
.dt-embed-footer-icon{width:20px;height:20px;margin-right:8px;border-radius:50%;object-fit:contain}
.dt-embed-footer-separator{margin:0 4px;font-weight:500}
.dt-components{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.dt-component-row{display:flex;flex-wrap:wrap;gap:8px}
.dt-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:60px;height:32px;padding:2px 16px;border-radius:8px;color:#fff;font-size:14px;line-height:16px;font-weight:500;white-space:nowrap;user-select:none;cursor:default}
.dt-button-primary{background:#5865f2}
.dt-button-secondary,.dt-button-link,.dt-button-premium{background:#4e5058}
.dt-button-success{background:#248046}
.dt-button-danger{background:#da373c}
.dt-button .dt-emoji,.dt-button .dt-emoji-u{width:18px;height:18px;margin:0;font-size:18px;line-height:18px;vertical-align:0}
.dt-button-external{width:16px;height:16px;margin-left:2px}
.dt-disabled{opacity:.5;cursor:not-allowed}
.dt-select{display:flex;align-items:center;justify-content:space-between;width:400px;max-width:100%;height:40px;padding:8px 8px 8px 12px;border-radius:4px;background:var(--dt-bg-deep);border:1px solid var(--dt-bg-deep);color:var(--dt-muted);font-size:16px;font-weight:500}
.dt-select-caret{width:24px;height:24px;color:var(--dt-strong)}
.dt-sticker{margin-top:4px;line-height:0}
.dt-sticker img{width:160px;height:160px;object-fit:contain}
.dt-sticker-placeholder{display:inline-flex;align-items:center;justify-content:center;width:160px;height:160px;padding:8px;border-radius:8px;background:var(--dt-bg-alt);color:var(--dt-muted);font-size:14px;line-height:18px;text-align:center}
.dt-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.dt-reaction{display:inline-flex;align-items:center;gap:6px;height:28px;padding:2px 6px;border-radius:8px;background:var(--dt-bg-alt);border:1px solid transparent;color:var(--dt-soft)}
.dt-reaction .dt-emoji{width:16px;height:16px;margin:0;vertical-align:0}
.dt-reaction .dt-emoji-u{font-size:16px;line-height:16px;vertical-align:0}
.dt-reaction-count{font-size:14px;line-height:16px;font-weight:600}
.dt-reply{position:relative;display:flex;align-items:center;gap:4px;height:18px;margin-bottom:4px;font-size:14px;line-height:18px;color:var(--dt-soft);white-space:nowrap;overflow:hidden}
.dt-reply::before{content:"";position:absolute;display:block;left:-36px;top:8px;width:33px;height:12px;border-top:2px solid #4e5058;border-left:2px solid #4e5058;border-top-left-radius:6px;box-sizing:border-box}
.dt-message .dt-reply{overflow:visible}
.dt-reply-avatar{flex:none;width:16px;height:16px;border-radius:50%;object-fit:cover}
.dt-reply-name{flex:none;font-weight:500;color:var(--dt-strong);opacity:.64}
.dt-reply-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dt-reply-missing .dt-reply-text{font-style:italic;color:var(--dt-muted)}
.dt-message-deleted{box-shadow:inset 2px 0 0 var(--dt-danger);background:rgba(242,63,67,.05)}
.dt-message-deleted>:not(.dt-deleted-note):not(.dt-gutter-time){opacity:.55}
.dt-deleted-note{margin-top:2px;font-size:12px;line-height:16px;font-weight:500;color:#fa777c}
.dt-activity{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin:8px 16px 8px 72px;padding:6px 10px;border:1px dashed #f0b232;border-radius:6px;background:rgba(240,178,50,.08);color:#f6d58e;font-size:13px;line-height:18px}
.dt-activity-detail{color:var(--dt-soft)}
.dt-activity-time{margin-left:auto;font-size:11px;color:var(--dt-muted)}
@media (max-width:600px){.dt-message{padding-right:16px}.dt-file,.dt-select{width:100%}.dt-embed{max-width:100%}.dt-welcome-title{font-size:24px;line-height:30px}}
@media (prefers-reduced-motion:reduce){.dt-spoiler-text{transition:none}}
`.trim();
