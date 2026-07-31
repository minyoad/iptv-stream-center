async function run() {
  const res = await fetch("http://ip-api.com/json/222.76.174.37?lang=zh-CN");
  const data = await res.json();
  console.log(data);
}
run();
