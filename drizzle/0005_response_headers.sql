-- Responses gained `headers`: an object schema with one property per header.
UPDATE `endpoints` SET `responses` = (
	SELECT json_group_array(json_insert(`value`, '$.headers', json('{"type":"object","properties":{}}')))
	FROM (SELECT `value` FROM json_each(`endpoints`.`responses`) ORDER BY `key`)
);
