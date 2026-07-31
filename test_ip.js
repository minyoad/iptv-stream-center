async function run() {
  try {
    const res = await fetch("https://whois.pconline.com.cn/ipJson.jsp?ip=222.76.174.37&json=true");
    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder("gbk");
    const text = decoder.decode(buffer);
    console.log(text);
  } catch(e) { console.error(e) }
}
run();
