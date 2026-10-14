-- Extend the authorized private review scope without changing old findings,
-- their event history, or any reader/editor privileges.
ALTER TABLE public.owner_review_subjects
  DROP CONSTRAINT IF EXISTS owner_review_subjects_id_check;
ALTER TABLE public.owner_review_subjects
  ADD CONSTRAINT owner_review_subjects_id_check
  CHECK (id IN ('li-keyong','li-cunxu','zhu-wen','chai-rong',
    'li-siyuan','guo-wei','shi-jingtang','liu-zhiyuan','liu-chengyou'));
INSERT INTO public.owner_review_subjects(id,name) VALUES
  ('li-siyuan','李嗣源'),('guo-wei','郭威'),('shi-jingtang','石敬瑭'),
  ('liu-zhiyuan','刘知远'),('liu-chengyou','刘承祐')
  ON CONFLICT (id) DO NOTHING;
