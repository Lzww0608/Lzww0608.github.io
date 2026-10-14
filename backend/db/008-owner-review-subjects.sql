-- Extend the authorized private review scope without changing old findings,
-- their event history, or any reader/editor privileges.
ALTER TABLE public.owner_review_subjects
  DROP CONSTRAINT IF EXISTS owner_review_subjects_id_check;
ALTER TABLE public.owner_review_subjects
  ADD CONSTRAINT owner_review_subjects_id_check
  CHECK (id IN ('li-keyong','li-cunxu','zhu-wen','chai-rong',
    'li-siyuan','guo-wei','shi-jingtang','liu-zhiyuan','liu-chengyou',
    'shi-chonggui','li-conghou','li-congke','zhu-yougui','zhu-youzhen','chai-zongxun'));
INSERT INTO public.owner_review_subjects(id,name) VALUES
  ('li-siyuan','李嗣源'),('guo-wei','郭威'),('shi-jingtang','石敬瑭'),
  ('liu-zhiyuan','刘知远'),('liu-chengyou','刘承祐'),
  ('shi-chonggui','石重贵'),('li-conghou','李从厚'),('li-congke','李从珂'),
  ('zhu-yougui','朱友珪'),('zhu-youzhen','朱友贞'),('chai-zongxun','柴宗训')
  ON CONFLICT (id) DO NOTHING;
