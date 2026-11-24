(function(){const params=new URLSearchParams(location.search);params.delete('restore_trial');params.set('summary','1');location.replace('dashboard.html?'+params+location.hash);})();
