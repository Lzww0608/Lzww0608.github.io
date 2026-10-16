-- Extend the authorized private review scope without changing old findings,
-- their event history, or any reader/editor privileges.
ALTER TABLE public.owner_review_subjects
  DROP CONSTRAINT IF EXISTS owner_review_subjects_id_check;
ALTER TABLE public.owner_review_subjects
  ADD CONSTRAINT owner_review_subjects_id_check
  CHECK (id IN ('li-keyong','li-cunxu','zhu-wen','chai-rong','li-siyuan','guo-wei','shi-jingtang','liu-zhiyuan','liu-chengyou','shi-chonggui','li-conghou','li-congke','zhu-yougui','zhu-youzhen','chai-zongxun','li-bian','li-jing-southern-tang','li-yu','yang-pu','song-qiqiu','han-xizai','xu-xuan','liang-zhu-wen-mother-wang','liang-zhu-wen-consort-zhang','liang-zhu-wen-zhaoyi-chen','liang-zhu-wen-zhaorong-li','liang-liu-chong-mother','liang-zhu-jin-wife','liang-zhu-youwen-wife-wang','liang-zhu-yougui-wife-zhang'));
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
  ON CONFLICT (id) DO NOTHING;
