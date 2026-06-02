const axios = require('axios');

// 1. 从 GitHub Environment 变量中读取 Cookie
// 如果你在本地测试，可以先直接把你的 Cookie 字符串贴在下面的引号里
const COOKIE_STRING = process.env.MY_WEBSITE_COOKIE || `_ga=GA1.1.1783501504.1780363246; _ga_0P7PP0R7K3=GS2.1.s1780380751$o4$g1$t1780382968$j35$l0$h0; XSRF-TOKEN=eyJpdiI6IndnM01xM0pZUG1RWEx2TmZLK3paZkE9PSIsInZhbHVlIjoiOGl4aGFFUlg2ejZSa05hcWt6SXdQbTkreW1MY05vQ0EvRDRTbitnZWxGZndIcG5XVmNNNXFZSTVTbkYxTC8zU09xeXRLTmZxajN4OU9hUk1HeG9nMlhzUVpBZW1hUkJHRk5PWlI5TUhMbzdqNkJ4Sk9QZSsvK1VJZ0VtNkRrZGEiLCJtYWMiOiIzOTNjMTljMGZlYjM0NTBiNjVkODk3MzAxNjk5ZTAzYTgzZTcyMmYzM2IyODYyNmJlNDRjMzQzYmZlNmVmMjdhIiwidGFnIjoiIn0%3D; pelican_session=eyJpdiI6IlpvVFBEM3lPa21YWDFNM1Qrclhja2c9PSIsInZhbHVlIjoicGNXcW1xMjA1RDExUEpxYkFDc083NmZlY2N1dWFzTVUrSmZyWmxKVmxob1JPeWlXVktYSm8rcEpMS3o3UlRDN2g5QTNUcXlkL2ovWFQ2OE9IVGIrckhnd3NOeDFEZkFlSDhQbHloZm9TcnB3bFRQMjBYNlJDL0pZVVhncVJOTVYiLCJtYWMiOiI3NzE2NDVmZTJkZTFiNzhiNWU5MTFlNTA0NzFiOWFmNTljYjRhMWI0ZDRlOTY3ZWI1MDQ5NTQ5OWIwNzJmOThjIiwidGFnIjoiIn0%3D`;

async function renewServer() {
    console.log('🚀 开始直接发送底层网络请求进行续期...');

    try {
        const response = await axios.get('https://g4f.gg/myserverbbr', {
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                'cache-control': 'max-age=0',
                'cookie': COOKIE_STRING,
                'referer': 'https://g4f.gg/myserverbbr',
                'upgrade-insecure-requests': '1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
            }
        });

        console.log('✅ 请求发送成功！正在解析服务器当前状态...');

        // 从返回的 HTML 页面中用正则捞出剩余时间，用来验证是否真的续期成功
        const html = response.data;
        
        // 匹配类似于 01:58:14 格式的倒计时文本
        const timeRegex = /(\d{2}):(\d{2}):(\d{2})/;
        const match = html.match(timeRegex);

        if (match) {
            console.log(`🎉 续期检查完毕！当前服务器剩余时间为: ${match[0]}`);
        } else {
            console.log('⚠ 未能在页面中匹配到倒计时格式，可能需要重新登录或更新 Cookie。');
            // 打印一部分网页文本方便排查
            console.log('页面片段：', html.substring(0, 500));
        }

    } catch (error) {
        console.error('❌ 请求失败，错误信息:', error.message);
    }
}

renewServer();
