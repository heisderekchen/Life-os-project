const RELAY='https://fashion-source-connector.yecol.workers.dev/read';
const hosts=new Set(['commons.wikimedia.org','upload.wikimedia.org']);
export function sourceFetch(fetcher=fetch){const connected=(value,options={})=>{const u=new URL(value);if(hosts.has(u.hostname)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port)return fetcher(RELAY+'?url='+encodeURIComponent(u.href),{...options,redirect:'error'});return fetcher(value,options);};connected.trustedRelayHosts=hosts;return connected;}
