const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(__dirname + '/thu-graduate-course-helper.user.js', 'utf8');
const page = new JSDOM('<!doctype html><body></body>', {
  url: 'https://zhjwxk.cic.tsinghua.edu.cn/xkYjs.vxkYjsXkbBs.do?m=main',
  runScripts: 'outside-only',
});
page.window.__THU_COURSE_HELPER_TEST__ = {};
page.window.eval(source);
const {
  sessionPingUrl, sessionExpired, extractCourseRows, parseSchedule, parseStatsTable, statsResponseSignature, wishBreakdown, setCourseChecked, setCourseWish,
} = page.window.__THU_COURSE_HELPER_TEST__;

assert.equal(
  JSON.stringify(parseSchedule('2-4(前八周),2-3(前八周),4-6(全周)').map(({ day, slot, weeks }) => [day, slot, weeks])),
  JSON.stringify([[2, 4, '前八周'], [2, 3, '前八周'], [4, 6, '全周']]),
);
const ping = new URL(sessionPingUrl('2026-2027-1', 'test'));
assert.equal(ping.searchParams.get('m'), 'showTree');
assert.equal(ping.searchParams.get('p_xnxq'), '2026-2027-1');
assert.equal(ping.searchParams.get('_tm_keepalive'), 'test');
assert.equal(sessionExpired('用户登陆超时或访问内容不存在。'), true);
assert.equal(sessionExpired('研究生选课系统'), false);

const selection = new JSDOM(`<!doctype html><body><form>
<input id="p_kch"><button>提交</button><table>
<tr><td><input type="checkbox"></td><td>74100072</td><td>0</td><td><a id="td_1_kcm_a">数据仓库与数据挖掘</a></td><td><select><option value="3">第三志愿</option><option value="1">第一志愿</option></select></td><td>50</td><td>2-4(前八周),2-3(前八周)</td><td>50</td><td>2</td><td>宋韶旭</td><td>优先:软件学院学生</td></tr>
<tr><td><input type="checkbox"></td><td>74100072</td><td>1</td><td><a id="td_2_kcm_a">数据仓库与数据挖掘</a></td><td><select><option value="3">第三志愿</option><option value="1">第一志愿</option></select></td><td>50</td><td>3-4(全周)</td><td>50</td><td>2</td><td>测试教师</td><td></td></tr>
</table></form></body>`, { url: page.window.location.href });
let courses = extractCourseRows(selection.window.document);
assert.equal(courses[0].schedule, '2-4(前八周),2-3(前八周)');
assert.equal(courses[0].teacher, '宋韶旭');
setCourseChecked(selection.window.document, '74100072-0', true);
courses = extractCourseRows(selection.window.document);
assert.equal(courses[0].selected, true);
assert.equal(courses[1].selected, false);
setCourseChecked(selection.window.document, '74100072-1', true);
courses = extractCourseRows(selection.window.document);
assert.equal(courses[0].selected, false);
assert.equal(courses[1].selected, true);
setCourseWish(selection.window.document, '74100072-1', '1');
assert.equal(extractCourseRows(selection.window.document)[1].wishSelect.value, '1');

const stats = new JSDOM(`<!doctype html><body>填报志愿统计时间： 2026年09月03日20时00分
<form method="post" action="/xkYjs.xkYjsZytjb.do?m=tbzySearchXw&p_xnxq=2026-2027-1">
<input name="p_kch"><input name="p_kcm"><button name="query" value="查询">查询</button>
<table><tr><td><table><tr><td>课程号</td><td>课序号</td><td>课程名</td><td>开课系</td><td>可选容量</td><td>报名总人数 排序</td><td>学位课报名人数</td><td>非学位课报名人数</td></tr></table>
<table><tr><td>74100072</td><td>0</td><td>数据仓库与数据挖掘</td><td>软件学院</td><td>50</td><td>8</td><td>(8)0,0,0</td><td>0,0,0</td></tr></table></td></tr></table></form></body>`, { url: 'https://zhjwxk.cic.tsinghua.edu.cn/xkYjs.xkYjsZytjb.do?m=tbzySearchXw&p_xnxq=2026-2027-1' });
const result = parseStatsTable(stats.window.document, '74100072');
assert.equal(result.sections.get('0').total, 8);
assert.equal(result.sections.get('0').capacity, 50);
const wishes = wishBreakdown({ degree: '(8)1,2,3', nonDegree: '（2）4,5,6' });
assert.equal(wishes.priority, 10);
assert.equal(wishes.first, 5);
assert.equal(wishes.second, 7);
assert.equal(wishes.third, 9);
const beforeStats = statsResponseSignature(stats.window.document);
stats.window.document.querySelectorAll('tr')[1].cells[5].textContent = '9';
assert.notEqual(statsResponseSignature(stats.window.document), beforeStats);

console.log('userscript parser and selection checks passed');
