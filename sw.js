const CACHE_NAME = "hanzi-srs-v17";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/data.js",
  "./js/srs.js",
  "./js/store.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/china-map.svg",
  "./icons/dishes/baiqieji.jpg",
  "./icons/dishes/baozaifan.jpg",
  "./icons/dishes/beijing-kaoya.jpg",
  "./icons/dishes/chashao.jpg",
  "./icons/dishes/chongqing-huoguo.jpg",
  "./icons/dishes/choudoufu.jpg",
  "./icons/dishes/dandanmian.jpg",
  "./icons/dishes/dianxin.jpg",
  "./icons/dishes/dongpo-rou.jpg",
  "./icons/dishes/doufu.jpg",
  "./icons/dishes/fotiaoqiang.jpg",
  "./icons/dishes/gongbao-jiding.jpg",
  "./icons/dishes/guabao.jpg",
  "./icons/dishes/guoqiao-mixian.jpg",
  "./icons/dishes/hongshaorou.jpg",
  "./icons/dishes/huiguorou.jpg",
  "./icons/dishes/lanzhou-lamian.jpg",
  "./icons/dishes/liangpi.jpg",
  "./icons/dishes/luosifen.jpg",
  "./icons/dishes/luroufan.jpg",
  "./icons/dishes/malatang.jpg",
  "./icons/dishes/mapo-doufu.jpg",
  "./icons/dishes/niangao.jpg",
  "./icons/dishes/niurou-mian.jpg",
  "./icons/dishes/reganmian.jpg",
  "./icons/dishes/roujiamo.jpg",
  "./icons/dishes/shaola.jpg",
  "./icons/dishes/shengjianbao.jpg",
  "./icons/dishes/shuanyangrou.jpg",
  "./icons/dishes/suanlatang.jpg",
  "./icons/dishes/tangcu-liji.jpg",
  "./icons/dishes/tanghulu.jpg",
  "./icons/dishes/xiajiao.jpg",
  "./icons/dishes/xiaolongbao.jpg",
  "./icons/dishes/yangrou-paomo.jpg",
  "./icons/dishes/yansuji.jpg",
  "./icons/dishes/yuebing.jpg",
  "./icons/dishes/yuntunmian.jpg",
  "./icons/dishes/zhajiangmian.jpg",
  "./icons/dishes/zhenzhu-naicha.jpg",
  "./icons/dishes/zongzi.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached || new Response("Offline", { status: 503, statusText: "Offline" }));
      return cached || network;
    })
  );
});
