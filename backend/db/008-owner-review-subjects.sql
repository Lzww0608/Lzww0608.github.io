-- Extend the authorized private review scope without changing old findings,
-- their event history, or any reader/editor privileges.
ALTER TABLE public.owner_review_subjects
  DROP CONSTRAINT IF EXISTS owner_review_subjects_id_check;
ALTER TABLE public.owner_review_subjects
  ADD CONSTRAINT owner_review_subjects_id_check
  CHECK (id IN ('li-keyong','li-cunxu','zhu-wen','chai-rong','li-siyuan','guo-wei','shi-jingtang','liu-zhiyuan','liu-chengyou','shi-chonggui','li-conghou','li-congke','zhu-yougui','zhu-youzhen','chai-zongxun','li-bian','li-jing-southern-tang','li-yu','yang-pu','song-qiqiu','han-xizai','xu-xuan','liang-zhu-wen-mother-wang','liang-zhu-wen-consort-zhang','liang-zhu-wen-zhaoyi-chen','liang-zhu-wen-zhaorong-li','liang-liu-chong-mother','liang-zhu-jin-wife','liang-zhu-youwen-wife-wang','liang-zhu-yougui-wife-zhang','liang-zhu-youzhen-defei-zhang','liang-zhu-youzhen-consort-guo','liang-zhu-youyong-wife-shi','liang-zhu-youzhen-princess-shouchun','liang-zhu-youzhen-princess-shouchang','liang-zhu-yougui-mother-unknown','liang-zhu-wen-princess-anyang','liang-zhu-wen-princess-changle','liang-zhu-wen-princess-puning','liang-zhu-wen-princess-jinhua','liang-zhu-wen-princess-zhenning','liang-zhu-wen-sister-wanan','liang-zhu-wen-ancestor-fan','liang-zhu-wen-ancestor-yang','liang-zhu-wen-ancestor-liu','liang-duan-ning-sister-meiren','liang-princes-nurse-kong-xun-mother'));
INSERT INTO public.owner_review_subjects(id,name) VALUES
  ('li-siyuan','李嗣源'),('guo-wei','郭威'),('shi-jingtang','石敬瑭'),
  ('liu-zhiyuan','刘知远'),('liu-chengyou','刘承祐'),
  ('shi-chonggui','石重贵'),('li-conghou','李从厚'),('li-congke','李从珂'),
  ('zhu-yougui','朱友珪'),('zhu-youzhen','朱友贞'),('chai-zongxun','柴宗训'),
  ('li-bian','李昪'),('li-jing-southern-tang','李璟'),('li-yu','李煜'),('yang-pu','杨溥'),
  ('song-qiqiu','宋齐丘'),
  ('han-xizai','韩熙载'),
  ('xu-xuan','徐铉')
,
  ('liang-zhu-wen-mother-wang','文惠皇后王氏'),
  ('liang-zhu-wen-consort-zhang','元贞皇后张氏'),
  ('liang-zhu-wen-zhaoyi-chen','昭仪陈氏（后梁）'),
  ('liang-zhu-wen-zhaorong-li','昭容李氏（后梁）'),
  ('liang-liu-chong-mother','刘崇母（萧县）'),
  ('liang-zhu-jin-wife','朱瑾妻（被纳后为尼）'),
  ('liang-zhu-youwen-wife-wang','王氏（朱友文妻）'),
  ('liang-zhu-yougui-wife-zhang','张氏（朱友珪妻）')
,
  ('liang-zhu-youzhen-defei-zhang','德妃张氏（朱友贞妻）'),
  ('liang-zhu-youzhen-consort-guo','郭氏（朱友贞次妃）'),
  ('liang-zhu-youyong-wife-shi','石氏（朱友雍妻）'),
  ('liang-zhu-youzhen-princess-shouchun','寿春公主（后梁）'),
  ('liang-zhu-youzhen-princess-shouchang','寿昌公主（后梁）'),
  ('liang-zhu-yougui-mother-unknown','朱友珪生母（失姓）'),
  ('liang-zhu-wen-princess-anyang','安阳公主（朱温女）'),
  ('liang-zhu-wen-princess-changle','长乐公主（朱温女）'),
  ('liang-zhu-wen-princess-puning','普宁公主（朱温女）'),
  ('liang-zhu-wen-princess-jinhua','金华公主（朱温女）'),
  ('liang-zhu-wen-princess-zhenning','真宁公主（朱温女）'),
  ('liang-zhu-wen-sister-wanan','万安大长公主（朱温妹）'),
  ('liang-zhu-wen-ancestor-fan','宣僖皇后范氏（后梁）'),
  ('liang-zhu-wen-ancestor-yang','光孝皇后杨氏（后梁）'),
  ('liang-zhu-wen-ancestor-liu','昭懿皇后刘氏（后梁）'),
  ('liang-duan-ning-sister-meiren','段凝妹（梁太祖美人）'),
  ('liang-princes-nurse-kong-xun-mother','孔循养母（朱温诸子乳母）')
  ON CONFLICT (id) DO NOTHING;
